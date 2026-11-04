import { describe, expect, it } from 'vitest';
import { PayPalError } from '../../src/errors.js';
import { runCapturePhase } from '../../src/saga/capture.js';
import { runSettlement, runVoidPhase } from '../../src/saga/void.js';
import { CEILINGS, makeRig, seed, withGateway } from './rig.js';

const forbidden = (): PayPalError =>
  new PayPalError({
    kind: 'auth_failed',
    status: 403,
    name: 'forbidden',
    message: 'revoked',
    outcome: 'definite',
  });

describe('round 5 settlement fixes', () => {
  it('R5-S01 a hold whose void and truth read both fail goes to review after the deadline', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    const b2 = rig.auth['b2'] ?? '';
    const deps = withGateway(rig, {
      voidAuthorization: async (a, r) => {
        if (a === b2) throw forbidden();
        return rig.gw.voidAuthorization(a, r);
      },
      getHoldTruth: async (h) => {
        if (h.authId === b2) throw forbidden();
        return rig.gw.getHoldTruth(h);
      },
    });
    const first = await runSettlement(deps, 'auc1');
    expect(first).toMatchObject({ status: 'pending', reason: 'void_incomplete' });
    rig.clock.advance(300_000);
    expect(await runSettlement(deps, 'auc1')).toMatchObject({ status: 'pending' });
    rig.clock.advance(400_000);
    const out = await runSettlement(deps, 'auc1');
    expect(out).toMatchObject({ status: 'failed', reason: 'void_unconfirmed:b2' });
  });

  it('R5-S01 a winner remainder that stays unreadable goes to review after the deadline', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    await runCapturePhase(rig.deps, 'auc1');
    const b1 = rig.auth['b1'] ?? '';
    const deps = withGateway(rig, {
      getHoldTruth: async (h) => {
        if (h.authId === b1) throw forbidden();
        return rig.gw.getHoldTruth(h);
      },
    });
    expect(await runVoidPhase(deps, 'auc1')).toMatchObject({
      status: 'pending',
      reason: 'remainder_unavailable',
    });
    rig.clock.advance(700_000);
    expect(await runVoidPhase(deps, 'auc1')).toMatchObject({
      status: 'failed',
      reason: 'remainder_unconfirmed',
    });
  });
});
