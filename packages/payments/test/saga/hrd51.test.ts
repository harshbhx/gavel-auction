import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PayPalError } from '../../src/errors.js';
import { assertFakeInvariants } from '../../src/fake/invariants.js';
import { guardGateway, MemoryKillStateStore, PersistentKillSwitch } from '../../src/killswitch.js';
import { buildRequestId } from '../../src/requestId.js';
import { runCapturePhase } from '../../src/saga/capture.js';
import { createSettlement, DEFAULT_LEASE_TTL_MS } from '../../src/saga/create.js';
import { DEFAULT_UNKNOWN_DEADLINE_MS } from '../../src/saga/unknown.js';
import { runSettlement, type SettlementDeps } from '../../src/saga/void.js';
import { FileJournalStore } from '../../src/stores/file.js';
import { FRESH_HOLDS } from '../helpers/age.js';
import { CEILINGS, callsOf, makeRig, planFor, seed, withGateway, type Rig } from './rig.js';

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** Three candidates and a fourth registered bidder who never became one. */
const FOUR = { ...CEILINGS, b4: 15000 };

function authOf(rig: Rig, bidder: string): string {
  return rig.auth[bidder] ?? '';
}

function statusOf(rig: Rig, bidder: string): string {
  return rig.core.getAuthorization(authOf(rig, bidder)).status;
}

function alerts(rig: Rig): Array<{ label?: string; holdId?: string }> {
  return rig.audits.filter((a) => a.kind === 'settlement_alert');
}

function readFailure(): PayPalError {
  return new PayPalError({
    kind: 'server_error',
    status: 503,
    name: 'SERVICE_UNAVAILABLE',
    message: 'read failed',
    outcome: 'unknown',
  });
}

describe('RT4-saga-02 a killed process leaves its lease in journals.json', () => {
  it('the restarted process resumes the settlement at once', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gavel-lease-'));
    dirs.push(dir);
    const rig = makeRig(CEILINGS);
    const path = join(dir, 'journals.json');
    const before = new FileJournalStore(path);
    await createSettlement(
      { journals: before, ...FRESH_HOLDS },
      planFor(rig, CEILINGS, [
        ['b1', 22000],
        ['b2', 21000],
      ]),
    );
    // The run took the lease, renewed it for a slow call, and was killed with SIGKILL: no
    // `finally`, so the lease stays in the file for the full TTL.
    const now = rig.clock.nowMs();
    expect(await before.acquireLease('auc1', 'killed-run', DEFAULT_LEASE_TTL_MS, now)).toBe(true);

    const restarted = new FileJournalStore(path);
    const out = await runSettlement({ ...rig.deps, journals: restarted }, 'auc1');
    expect(out.status).toBe('settled');
    expect(rig.core.inspect(authOf(rig, 'b1')).capturedCents).toBe(22000);
    assertFakeInvariants(rig.core);
  });
});

describe('RT4-saga-03 holds nobody can be charged on are released while the capture waits', () => {
  it('a PENDING capture keeps the winner and the next candidate, and frees the rest', async () => {
    const rig = makeRig(FOUR);
    await seed(rig, undefined, FOUR);
    rig.core.inject('capture', 'capture_declined', authOf(rig, 'b1'), 1);
    rig.core.inject('capture', 'capture_pending', authOf(rig, 'b2'), 1);

    const out = await runSettlement(rig.deps, 'auc1');
    expect(out).toMatchObject({ status: 'pending', reason: 'capture_pending' });
    if (out.status !== 'pending') return;
    expect(out.journal.state).toBe('CAPTURING');
    // b1 failed for good and b4 was never a candidate: both are released now.
    expect(statusOf(rig, 'b1')).toBe('VOIDED');
    expect(statusOf(rig, 'b4')).toBe('VOIDED');
    expect(out.journal.voids).toMatchObject({ b1: 'voided', b4: 'voided' });
    // The capture in doubt and the fallback after it are untouched.
    expect(callsOf(rig, authOf(rig, 'b2'), 'void')).toBe(0);
    expect(callsOf(rig, authOf(rig, 'b3'), 'void')).toBe(0);
    expect(statusOf(rig, 'b3')).toBe('CREATED');

    // Waiting again sends nothing new.
    expect(await runSettlement(rig.deps, 'auc1')).toMatchObject({ reason: 'capture_pending' });
    expect(callsOf(rig, authOf(rig, 'b1'), 'void')).toBe(1);
    expect(callsOf(rig, authOf(rig, 'b4'), 'void')).toBe(1);

    const captureId = rig.core.getAuthorization(authOf(rig, 'b2')).captures[0]?.id ?? '';
    rig.core.completeCapture(captureId);
    const done = await runSettlement(rig.deps, 'auc1');
    expect(done.status).toBe('settled');
    if (done.status !== 'settled') return;
    expect(done.journal.winner).toMatchObject({ bidderId: 'b2', amountCents: 21000 });
    expect(statusOf(rig, 'b3')).toBe('VOIDED');
    for (const b of ['b1', 'b3', 'b4']) {
      expect(rig.core.inspect(authOf(rig, b))).toMatchObject({ voidEffects: 1, capturedCents: 0 });
    }
    assertFakeInvariants(rig.core);
  });

  it('the kill switch keeps every candidate and still releases the others (R-PAY-063)', async () => {
    const rig = makeRig(FOUR);
    await seed(rig, undefined, FOUR);
    const ks = new PersistentKillSwitch({
      store: new MemoryKillStateStore(),
      audit: rig.deps.audit,
      clock: rig.deps.clock,
    });
    const deps: SettlementDeps = { ...rig.deps, gateway: guardGateway(rig.gw, ks), killSwitch: ks };
    await ks.engage('incident', 'ops');

    const out = await runSettlement(deps, 'auc1');
    expect(out).toMatchObject({ status: 'pending', reason: 'kill_switch' });
    expect(statusOf(rig, 'b4')).toBe('VOIDED');
    for (const b of ['b1', 'b2', 'b3']) {
      expect(statusOf(rig, b)).toBe('CREATED');
      expect(callsOf(rig, authOf(rig, b), 'void')).toBe(0);
    }
    expect(rig.core.calls.filter((c) => c.op === 'capture')).toHaveLength(0);

    await ks.release('ops');
    const done = await runSettlement(deps, 'auc1');
    expect(done.status).toBe('settled');
    expect(rig.core.inspect(authOf(rig, 'b1')).capturedCents).toBe(22000);
    expect(rig.core.inspect(authOf(rig, 'b4')).voidEffects).toBe(1);
    assertFakeInvariants(rig.core);
  });
});

describe('RT4-saga-03 a wait nothing ends by itself raises one settlement_alert', () => {
  it('truth reads that keep failing alert once past the deadline, then the sale goes on', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    let down = true;
    const deps = withGateway(rig, {
      getHoldTruth: async (h) => {
        if (down) throw readFailure();
        return rig.gw.getHoldTruth(h);
      },
    });

    expect(await runSettlement(deps, 'auc1')).toMatchObject({
      status: 'pending',
      reason: 'truth_unavailable',
    });
    expect(alerts(rig)).toEqual([]);
    rig.clock.advance(DEFAULT_UNKNOWN_DEADLINE_MS + 1);
    const late = await runSettlement(deps, 'auc1');
    expect(late).toMatchObject({ status: 'pending', reason: 'truth_unavailable' });
    if (late.status !== 'pending') return;
    // Still waiting: no review, no capture, every hold kept.
    expect(late.journal.state).toBe('CAPTURING');
    expect(alerts(rig)).toEqual([
      expect.objectContaining({ label: 'truth_unavailable:b1', holdId: 'hold-b1' }),
    ]);
    await runSettlement(deps, 'auc1');
    expect(alerts(rig)).toHaveLength(1);
    expect(rig.core.calls.filter((c) => c.op === 'capture' || c.op === 'void')).toHaveLength(0);

    down = false;
    const done = await runSettlement(deps, 'auc1');
    expect(done.status).toBe('settled');
    if (done.status !== 'settled') return;
    expect(done.journal.winner).toMatchObject({ bidderId: 'b1', amountCents: 22000 });
    expect(Object.keys(done.journal.voids)).not.toContain('stalled_since:capture');
    assertFakeInvariants(rig.core);
  });

  it('an OAuth failure on every capture alerts once past the deadline', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    const deps = withGateway(rig, {
      capture: async () => {
        throw new PayPalError({
          kind: 'auth_failed',
          status: 401,
          name: 'invalid_client',
          message: 'token refused',
          outcome: 'definite',
        });
      },
    });
    expect(await runCapturePhase(deps, 'auc1')).toMatchObject({ reason: 'auth_unavailable' });
    rig.clock.advance(DEFAULT_UNKNOWN_DEADLINE_MS + 1);
    expect(await runCapturePhase(deps, 'auc1')).toMatchObject({ reason: 'auth_unavailable' });
    expect(alerts(rig)).toEqual([
      expect.objectContaining({ label: 'auth_unavailable:b1', holdId: 'hold-b1' }),
    ]);
  });

  it('a capture PayPal keeps PENDING alerts once, and is still waited for', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    rig.core.inject('capture', 'capture_pending', authOf(rig, 'b1'), 1);
    expect(await runSettlement(rig.deps, 'auc1')).toMatchObject({ reason: 'capture_pending' });
    expect(alerts(rig)).toEqual([]);
    rig.clock.advance(DEFAULT_UNKNOWN_DEADLINE_MS + 1);
    const late = await runSettlement(rig.deps, 'auc1');
    expect(late).toMatchObject({ status: 'pending', reason: 'capture_pending' });
    expect(alerts(rig)).toEqual([
      expect.objectContaining({ label: 'capture_pending:b1', holdId: 'hold-b1' }),
    ]);
    await runSettlement(rig.deps, 'auc1');
    expect(alerts(rig)).toHaveLength(1);
    expect(statusOf(rig, 'b2')).toBe('CREATED');
  });
});

describe('RT4-saga-04 a crash right after a capture does not lose its audit row', () => {
  it('the resumed run that adopts the capture writes the paypal_call row of its request', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    const crashing: SettlementDeps = {
      ...rig.deps,
      boundary: (label) => {
        if (label === 'after:capture') throw new Error('process died');
      },
    };
    await expect(runCapturePhase(crashing, 'auc1')).rejects.toThrow('process died');
    const captureRows = (): unknown[] =>
      rig.audits.filter((a) => a.kind === 'paypal_call' && a.op === 'capture');
    expect(captureRows()).toEqual([]);

    const out = await runCapturePhase(rig.deps, 'auc1');
    expect(out.status).toBe('captured');
    if (out.status !== 'captured') return;
    expect(out.journal.history.map((h) => h.label)).toContain('journaled:adopted');
    const requestId = buildRequestId({
      auctionId: 'auc1',
      op: 'capture',
      holdId: 'hold-b1',
      amountCents: 22000,
      generation: 0,
    });
    expect(captureRows()).toEqual([
      expect.objectContaining({
        auctionId: 'auc1',
        holdId: 'hold-b1',
        requestId,
        outcome: 'definite',
        label: 'adopted',
      }),
    ]);
    // The row precedes the state change it explains.
    const kinds = rig.audits.map((a) => (a.kind === 'paypal_call' ? a.op : a.to));
    expect(kinds.indexOf('capture')).toBeLessThan(kinds.indexOf('CAPTURED'));
    expect(rig.core.inspect(authOf(rig, 'b1')).capturedCents).toBe(22000);
  });
});
