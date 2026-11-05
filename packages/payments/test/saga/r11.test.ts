import { afterEach, describe, expect, it } from 'vitest';
import { DAY_MS, FakeClock } from '../../src/fake/core.js';
import { assertFakeInvariants } from '../../src/fake/invariants.js';
import { FakePayPalServer } from '../../src/fake/server.js';
import { PayPalGateway } from '../../src/gateway.js';
import { TokenManager } from '../../src/oauth.js';
import {
  DEFAULT_PENDING_CAPTURE_DEADLINE_MS,
  runCapturePhase,
  type CaptureOutcome,
} from '../../src/saga/capture.js';
import { createSettlement } from '../../src/saga/create.js';
import { voidAllLiveHolds, type VoidAllOutcome } from '../../src/saga/killswitch.js';
import {
  DEFAULT_HONOR_SAFE_MS,
  persistReauthorization,
  reauthorizeIfDue,
} from '../../src/saga/reauth.js';
import { reviewKeepHolds, runSettlement, type SettlementDeps } from '../../src/saga/void.js';
import { MemoryHoldStore, MemoryJournalStore } from '../../src/stores/memory.js';
import { Transport } from '../../src/transport.js';
import type { Journal, PaymentAudit, SettlementPlan } from '../../src/types.js';
import { FRESH_HOLDS } from '../helpers/age.js';
import { CEILINGS as RIG_CEILINGS, makeRig, refusal, seed, withGateway } from './rig.js';

/**
 * Round 11 red-team findings on the settlement saga (R11-O01 to R11-O06). The saga runs
 * through PayPalGateway, the client code that talks to PayPal, against the fake PayPal
 * server over HTTP, so the response shapes are the ones the real API sends.
 */

const START_MS = 1_800_000_000_000;
const noSleep = async (): Promise<void> => undefined;
const CEILINGS: Record<string, number> = { b1: 30000, b2: 25000 };

interface World {
  server: FakePayPalServer;
  clock: FakeClock;
  journals: MemoryJournalStore;
  plan: SettlementPlan;
  audits: PaymentAudit[];
  deps: SettlementDeps;
  auth: (bidder: string) => string;
}

const open: FakePayPalServer[] = [];
afterEach(async () => {
  for (const s of open.splice(0)) await s.stop();
});

/** Two approved holds, b1 at 220.00 then b2 at 210.00, settled through the real gateway. */
async function world(opts: { ignorePrefer?: boolean } = {}): Promise<World> {
  const clock = new FakeClock(START_MS);
  const server = new FakePayPalServer({
    timers: { sleep: noSleep },
    core: { clock },
    ...(opts.ignorePrefer === true ? { ignorePrefer: true } : {}),
  });
  await server.start();
  open.push(server);
  const gateway = new PayPalGateway({
    auth: new TokenManager({
      transport: new Transport({ sleep: noSleep }),
      baseUrl: server.url,
      clientId: 'fake-client',
      clientSecret: 'fake-secret-value',
    }),
    fake: true,
    clock: { nowMs: () => clock.nowMs() },
  });
  const holds: SettlementPlan['holds'] = {};
  for (const [bidder, cents] of Object.entries(CEILINGS)) {
    const order = server.core.createOrder(
      { holdId: `hold-${bidder}`, amountCents: cents, description: 'r11' },
      `ord-${bidder}`,
    );
    server.core.approveOrder(order.id);
    const a = server.core.authorizeOrder(order.id, `auth-${bidder}`);
    holds[bidder] = {
      holdId: `hold-${bidder}`,
      authId: a.authId,
      ceilingCents: cents,
      createdAtMs: START_MS,
      orderId: order.id,
    };
  }
  const plan: SettlementPlan = {
    auctionId: 'auc1',
    reserveCents: 5000,
    candidates: [
      { bidderId: 'b1', priceCents: 22000 },
      { bidderId: 'b2', priceCents: 21000 },
    ],
    holds,
  };
  const journals = new MemoryJournalStore();
  await createSettlement({ journals, ...FRESH_HOLDS }, plan);
  const audits: PaymentAudit[] = [];
  return {
    server,
    clock,
    journals,
    plan,
    audits,
    deps: {
      journals,
      gateway,
      audit: { append: async (e) => void audits.push(e) },
      clock: { nowMs: () => clock.nowMs() },
    },
    auth: (bidder) => holds[bidder]?.authId ?? '',
  };
}

function labels(j: Journal): string[] {
  return j.history.map((h) => h.label);
}

describe('R11-O02 a COMPLETED capture in the minimal answer is the sale', () => {
  it('settles in one run when PayPal answers id, status and links only (the G1.5 shape)', async () => {
    const w = await world({ ignorePrefer: true });
    const out = await runSettlement(w.deps, 'auc1');
    expect(out.status).toBe('settled');
    if (out.status !== 'settled') return;
    expect(out.journal.winner).toMatchObject({ bidderId: 'b1', amountCents: 22000 });
    expect(labels(out.journal)).toContain('journaled:capture_ok');
    expect(out.journal.unknownSince).toBeNull();
    // The money audit says what PayPal said: a definite capture.
    const call = w.audits.find((a) => a.kind === 'paypal_call' && a.op === 'capture');
    expect(call).toMatchObject({ outcome: 'definite', status: 201, label: 'ok' });
    expect(w.server.core.inspect(w.auth('b2')).voidEffects).toBe(1);
    assertFakeInvariants(w.server.core);
  });

  it('does not wait for a truth read: reads failing after the capture leave it a capture', async () => {
    const w = await world({ ignorePrefer: true });
    const deps: SettlementDeps = {
      ...w.deps,
      boundary: (label) => {
        // From the capture answer on, PayPal reads fail for a long time.
        if (label === 'after:capture') {
          w.server.faults.add({ kind: 'http_500', op: 'get', times: 10_000 });
        }
      },
    };
    const out = await runCapturePhase(deps, 'auc1');
    expect(out.status).toBe('captured');
    if (out.status !== 'captured') return;
    expect(out.journal.state).toBe('CAPTURED');
    expect(out.journal.history.at(-1)?.label).toBe('journaled:capture_ok');
  });
});

describe('R11-O03 a PENDING capture is not the sale', () => {
  async function pendingOnB1(): Promise<{ w: World; captureId: string }> {
    const w = await world();
    w.server.core.inject('capture', 'capture_pending', w.auth('b1'));
    const first = await runSettlement(w.deps, 'auc1');
    expect(first.status).toBe('pending');
    const second = await runSettlement(w.deps, 'auc1');
    expect(second).toMatchObject({ status: 'pending', reason: 'capture_pending' });
    const j = await w.journals.load('auc1');
    expect(j?.state).toBe('CAPTURING');
    expect(j?.winner).toBeNull();
    // The runner-up's hold stays live while the winner's capture can still fail.
    expect(w.server.core.inspect(w.auth('b2')).voidEffects).toBe(0);
    const captureId = w.server.core.getAuthorization(w.auth('b1')).captures[0]?.id ?? '';
    return { w, captureId };
  }

  it('falls back to the runner-up when PayPal declines it, and charges nobody twice', async () => {
    const { w, captureId } = await pendingOnB1();
    w.server.core.denyCapture(captureId);
    const out = await runSettlement(w.deps, 'auc1');
    expect(out.status).toBe('settled');
    if (out.status !== 'settled') return;
    expect(out.journal.failed).toEqual([{ bidderId: 'b1', reason: 'capture_declined' }]);
    expect(out.journal.winner).toMatchObject({ bidderId: 'b2', amountCents: 21000 });
    expect(w.server.core.inspect(w.auth('b2')).capturedCents).toBe(21000);
    expect(w.server.core.inspect(w.auth('b1'))).toMatchObject({ capturedCents: 0, voidEffects: 1 });
    assertFakeInvariants(w.server.core);
  });

  it('adopts it once PayPal completes it, and only then releases the runner-up', async () => {
    const { w, captureId } = await pendingOnB1();
    w.server.core.completeCapture(captureId);
    const out = await runSettlement(w.deps, 'auc1');
    expect(out.status).toBe('settled');
    if (out.status !== 'settled') return;
    expect(out.journal.winner).toMatchObject({ bidderId: 'b1', captureId, amountCents: 22000 });
    expect(w.server.core.inspect(w.auth('b2')).voidEffects).toBe(1);
    assertFakeInvariants(w.server.core);
  });

  it('goes to review with both holds kept when it stays pending past the deadline', async () => {
    const { w } = await pendingOnB1();
    // R12-P01: a PENDING capture waits under its own deadline, not the ten-minute one.
    w.clock.advance(601_000);
    expect(await runSettlement(w.deps, 'auc1')).toMatchObject({
      status: 'pending',
      reason: 'capture_pending',
    });
    w.clock.advance(DEFAULT_PENDING_CAPTURE_DEADLINE_MS);
    const out = await runSettlement(w.deps, 'auc1');
    expect(out).toMatchObject({ status: 'failed', reason: 'capture_outcome_unknown' });
    expect(w.server.core.inspect(w.auth('b1')).voidEffects).toBe(0);
    expect(w.server.core.inspect(w.auth('b2')).voidEffects).toBe(0);
  });
});

describe('R11-O06 a reauthorized hold is captured under the id PayPal returned', () => {
  it('stores the new id with the journal hold and the hold record, then captures it', async () => {
    const w = await world();
    w.clock.advance(3 * DAY_MS + 3_600_000);
    const hold = w.plan.holds['b1'];
    if (hold === undefined) throw new Error('rig');
    const r = await reauthorizeIfDue(
      w.deps,
      'auc1',
      {
        holdId: hold.holdId,
        authId: hold.authId,
        ceilingCents: hold.ceilingCents,
        startedAtMs: START_MS,
        generation: 0,
      },
      { enabled: true, honorSafeMs: DEFAULT_HONOR_SAFE_MS },
    );
    expect(r.status).toBe('reauthorized');
    if (r.status !== 'reauthorized') return;
    expect(r.authId).not.toBe(hold.authId);
    expect(r.previousAuthId).toBe(hold.authId);

    const records = new MemoryHoldStore();
    await records.put({
      holdId: hold.holdId,
      auctionId: 'auc1',
      bidderId: 'b1',
      orderId: hold.orderId ?? '',
      authId: hold.authId,
      ceilingCents: hold.ceilingCents,
      status: 'HELD',
      createdAtMs: START_MS,
    });
    const saved = await persistReauthorization(
      { journals: w.journals, holds: records, clock: w.deps.clock },
      'auc1',
      hold.holdId,
      r,
    );
    expect(saved).toBe('saved');
    expect(await records.get(hold.holdId)).toMatchObject({
      authId: r.authId,
      priorAuthIds: [hold.authId],
    });

    const out = await runSettlement(w.deps, 'auc1');
    expect(out.status).toBe('settled');
    if (out.status !== 'settled') return;
    expect(out.journal.winner).toMatchObject({ bidderId: 'b1', amountCents: 22000 });
    expect(w.server.core.inspect(r.authId).capturedCents).toBe(22000);
    // Nothing stays authorized: the old id is closed and the runner-up is voided.
    expect(w.server.core.getAuthorization(hold.authId).status).toBe('VOIDED');
    expect(w.server.core.getAuthorization(w.auth('b2')).status).toBe('VOIDED');
    assertFakeInvariants(w.server.core);
  });
});

describe('R11-O05 a configured lease owner still gives every run its own lease', () => {
  it('voidAll with the same configured owner is busy while a capture is in flight', async () => {
    const w = await world();
    let voidAll: Promise<VoidAllOutcome> | undefined;
    const deps: SettlementDeps = {
      ...w.deps,
      owner: 'service-1',
      boundary: async (label) => {
        if (label === 'before:capture' && voidAll === undefined) {
          voidAll = voidAllLiveHolds({ ...w.deps, owner: 'service-1' }, 'auc1', 'ops');
          await voidAll;
        }
      },
    };
    const out = await runCapturePhase(deps, 'auc1');
    expect(await voidAll).toEqual({ status: 'busy' });
    expect(out.status).toBe('captured');
    expect(w.server.core.inspect(w.auth('b1')).capturedCents).toBe(22000);
    expect(w.server.core.inspect(w.auth('b2')).voidEffects).toBe(0);
  });

  it('a second capture run with the same configured owner is busy', async () => {
    const w = await world();
    let second: Promise<CaptureOutcome> | undefined;
    const deps: SettlementDeps = {
      ...w.deps,
      owner: 'service-1',
      boundary: async (label) => {
        if (label === 'before:capture' && second === undefined) {
          second = runCapturePhase({ ...w.deps, owner: 'service-1' }, 'auc1');
          await second;
        }
      },
    };
    const out = await runCapturePhase(deps, 'auc1');
    expect(await second).toEqual({ status: 'busy' });
    expect(out.status).toBe('captured');
    expect(w.server.core.inspect(w.auth('b1')).capturedCents).toBe(22000);
  });
});

describe('R11-O01, R11-O04 one keep-set for every review release', () => {
  const TWO: Array<[string, number]> = [
    ['b1', 22000],
    ['b2', 21000],
  ];

  it('a review in doubt keeps the capture in doubt and the next candidates, not the others', async () => {
    const rig = makeRig(RIG_CEILINGS);
    await seed(rig, TWO);
    rig.core.inject('capture', 'timeout_before', rig.auth['b1'] ?? '', 10);
    await runSettlement(rig.deps, 'auc1');
    rig.clock.advance(601_000);
    const out = await runSettlement(rig.deps, 'auc1');
    expect(out.status).toBe('failed');
    const j = await rig.journals.load('auc1');
    if (j === null) throw new Error('journal');
    const now = rig.clock.nowMs();
    expect(reviewKeepHolds(j, { nowMs: now })).toEqual(new Set(['hold-b1', 'hold-b2']));
    // After a day, or on an operator release, only the capture in doubt stays.
    expect(reviewKeepHolds(j, { nowMs: now + 86_401_000 })).toEqual(new Set(['hold-b1']));
    expect(reviewKeepHolds(j, { nowMs: now, releaseAll: true })).toEqual(new Set(['hold-b1']));
  });

  it('never keeps a candidate that already failed', async () => {
    const rig = makeRig(RIG_CEILINGS);
    await seed(rig);
    rig.core.inject('capture', 'capture_declined', rig.auth['b1'] ?? '', 1);
    rig.core.inject('capture', 'timeout_before', rig.auth['b2'] ?? '', 10);
    await runSettlement(rig.deps, 'auc1');
    rig.clock.advance(601_000);
    await runSettlement(rig.deps, 'auc1');
    const j = await rig.journals.load('auc1');
    if (j === null) throw new Error('journal');
    expect(j.state).toBe('FAILED_NEEDS_REVIEW');
    expect(reviewKeepHolds(j, { nowMs: rig.clock.nowMs() })).toEqual(
      new Set(['hold-b2', 'hold-b3']),
    );
  });

  it('a no-sale review raised in the void phase keeps nothing and releases the last candidate', async () => {
    const rig = makeRig(RIG_CEILINGS);
    await seed(rig, TWO);
    // Both captures are declined: no sale. The void of b2 then fails with a 5xx, also on the
    // retry after the deadline (R12-P02: a run retries before it judges the age).
    rig.core.inject('capture', 'capture_declined', null, 2);
    rig.core.inject('void', 'http_500', rig.auth['b2'] ?? '', 2);
    expect(await runSettlement(rig.deps, 'auc1')).toMatchObject({ status: 'pending' });
    rig.clock.advance(601_000);
    const out = await runSettlement(rig.deps, 'auc1');
    expect(out).toMatchObject({ status: 'failed', reason: 'void_unconfirmed:b2' });
    const j = await rig.journals.load('auc1');
    if (j === null) throw new Error('journal');
    expect(j.cursor).toBe(1);
    expect(reviewKeepHolds(j, { nowMs: rig.clock.nowMs() })).toEqual(new Set());
    // The next run releases b2: no capture on it can be pending.
    await runSettlement(rig.deps, 'auc1');
    expect(rig.core.inspect(rig.auth['b2'] ?? '').voidEffects).toBe(1);
    expect((await rig.journals.load('auc1'))?.voids['b2']).toBe('voided');
    assertFakeInvariants(rig.core);
  });

  it('a sale in review keeps only the winner', async () => {
    const rig = makeRig(RIG_CEILINGS);
    await seed(rig, TWO);
    // A slow release no longer ends a sale in review (R12-P02); a void PayPal refuses on a
    // live hold until the resume budget is spent still does (R-PAY-058).
    const b2 = rig.auth['b2'] ?? '';
    const deps = {
      ...withGateway(rig, {
        voidAuthorization: async (a, r) => {
          if (a === b2) throw refusal();
          return rig.gw.voidAuthorization(a, r);
        },
      }),
      maxVoidResumes: 0,
    };
    await runSettlement(deps, 'auc1');
    const out = await runSettlement(deps, 'auc1');
    expect(out).toMatchObject({ status: 'failed', reason: 'void_failed:b2' });
    const j = await rig.journals.load('auc1');
    if (j === null) throw new Error('journal');
    expect(reviewKeepHolds(j, { nowMs: rig.clock.nowMs() })).toEqual(new Set(['hold-b1']));
  });
});
