import { describe, expect, it } from 'vitest';
import { PayPalError } from '../../src/errors.js';
import type { ErrorKind } from '../../src/types.js';
import { runCapturePhase } from '../../src/saga/capture.js';
import { runSettlement } from '../../src/saga/void.js';
import { assertFakeInvariants } from '../../src/fake/invariants.js';
import { CEILINGS, makeRig, seed, withGateway } from './rig.js';

function fault(kind: ErrorKind, status: number): PayPalError {
  return new PayPalError({ kind, status, name: kind, message: kind, outcome: 'definite' });
}

describe('round 4 settlement fixes', () => {
  it('R4-S01 a long outage on voids does not use the resume budget', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    const b2 = rig.auth['b2'] ?? '';
    let down = true;
    const deps = withGateway(rig, {
      voidAuthorization: async (a, r) => {
        if (a === b2 && down) {
          throw new PayPalError({
            kind: 'server_error',
            status: 500,
            name: 'server_error',
            message: 'down',
            outcome: 'unknown',
          });
        }
        return rig.gw.voidAuthorization(a, r);
      },
    });
    for (let i = 0; i < 10; i += 1) {
      const out = await runSettlement(deps, 'auc1');
      expect(out).toMatchObject({ status: 'pending', reason: 'void_incomplete' });
    }
    down = false;
    const done = await runSettlement(deps, 'auc1');
    expect(done.status).toBe('settled');
    assertFakeInvariants(rig.core);
  });

  it('R4-S02 a lagging read of the winner does not strand the losers', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    const b1 = rig.auth['b1'] ?? '';
    let lag = 2;
    const deps = withGateway(rig, {
      getHoldTruth: async (h) => {
        const truth = await rig.gw.getHoldTruth(h);
        if (h.authId === b1 && lag > 0) {
          lag -= 1;
          return { ...truth, capturedCents: 0 };
        }
        return truth;
      },
    });
    const out = await runSettlement(deps, 'auc1');
    expect(out.status).toBe('settled');
    assertFakeInvariants(rig.core);
  });

  it('R4-S02 a real mismatch still voids the losers before it fails', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    const b1 = rig.auth['b1'] ?? '';
    const deps = withGateway(rig, {
      getHoldTruth: async (h) => ({
        ...(await rig.gw.getHoldTruth(h)),
        capturedCents: h.authId === b1 ? 1 : 0,
      }),
    });
    const out = await runSettlement(deps, 'auc1');
    expect(out).toMatchObject({ status: 'failed', reason: 'mismatch' });
    expect(rig.core.inspect(rig.auth['b2'] ?? '').voidEffects).toBe(1);
    expect(rig.core.inspect(rig.auth['b3'] ?? '').voidEffects).toBe(1);
    assertFakeInvariants(rig.core);
  });

  it('R4-S02 an unreadable winner does not block the loser voids', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    rig.core.inject('get', 'http_500', rig.auth['b1'] ?? '', 1);
    const out = await runSettlement(rig.deps, 'auc1');
    expect(out).toMatchObject({ status: 'pending', reason: 'remainder_unavailable' });
    expect(rig.core.inspect(rig.auth['b2'] ?? '').voidEffects).toBe(1);
    expect(rig.core.inspect(rig.auth['b3'] ?? '').voidEffects).toBe(1);
    assertFakeInvariants(rig.core);
  });

  it('R4-S03 not_found on a void is not released while the hold is live', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    const b2 = rig.auth['b2'] ?? '';
    const deps = withGateway(rig, {
      voidAuthorization: async (a, r) => {
        if (a === b2) throw fault('not_found', 404);
        return rig.gw.voidAuthorization(a, r);
      },
    });
    const out = await runSettlement(deps, 'auc1');
    expect(out).toMatchObject({ status: 'pending', reason: 'void_incomplete' });
    if (out.status !== 'pending') return;
    expect(out.journal.voids['b2']).toBe('VOID_FAILED');
    assertFakeInvariants(rig.core);
  });

  it('R4-S04 an auth fault on capture is pending and the next run captures', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    let broken = true;
    const deps = withGateway(rig, {
      capture: async (a, i) => {
        if (broken) throw fault('auth_failed', 401);
        return rig.gw.capture(a, i);
      },
    });
    const first = await runCapturePhase(deps, 'auc1');
    expect(first).toMatchObject({ status: 'pending', reason: 'auth_unavailable' });
    broken = false;
    const second = await runCapturePhase(deps, 'auc1');
    expect(second.status).toBe('captured');
    assertFakeInvariants(rig.core);
  });

  it('R4-S05 the kill switch pauses the unknown clock', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    let engaged = false;
    const timeout = new PayPalError({
      kind: 'network',
      status: 0,
      name: 'network',
      message: 'timeout',
      outcome: 'unknown',
    });
    const base = withGateway(rig, {
      capture: async () => {
        throw timeout;
      },
    });
    const deps = {
      ...base,
      killSwitch: {
        isEngaged: async () => ({ engaged }),
        engage: async () => undefined,
        release: async () => undefined,
      },
    };
    expect(await runCapturePhase(deps, 'auc1')).toMatchObject({
      status: 'pending',
      reason: 'capture_outcome_unknown',
    });
    engaged = true;
    rig.clock.advance(60 * 60 * 1000);
    expect(await runCapturePhase(deps, 'auc1')).toMatchObject({
      status: 'pending',
      reason: 'kill_switch',
    });
    assertFakeInvariants(rig.core);
  });
});
