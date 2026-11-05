import { describe, expect, it } from 'vitest';
import { classifyError } from '../../src/errorMap.js';
import { assertFakeInvariants } from '../../src/fake/invariants.js';
import { runCapturePhase } from '../../src/saga/capture.js';
import { releaseWinnerRemainder, remainderKey } from '../../src/saga/remainder.js';
import { runSettlement, runVoidPhase } from '../../src/saga/void.js';
import { CEILINGS, makeRig, refusal, seed, withGateway } from './rig.js';

describe('T-PAY-043 winner remainder', () => {
  for (const auto of [true, false]) {
    it(`autoReleaseRemainder ${auto}: released + captured equals the hold`, async () => {
      const rig = makeRig(CEILINGS, { autoReleaseRemainder: auto });
      await seed(rig);
      const out = await runSettlement(rig.deps, 'auc1');
      expect(out.status).toBe('settled');
      if (out.status !== 'settled') return;
      const b1 = rig.auth['b1'] ?? '';
      const key = remainderKey('b1');
      expect(rig.core.inspect(b1).capturedCents).toBe(22000);
      expect(rig.core.released(b1) + rig.core.inspect(b1).capturedCents).toBe(30000);
      if (auto) {
        // PayPal let the remainder go by itself: no second effect on the hold.
        expect(rig.core.inspect(b1).voidEffects).toBe(0);
        expect(out.journal.voids[key]).toBe('remainder_released');
      } else {
        expect(rig.core.inspect(b1).voidEffects).toBe(1);
        expect(out.journal.voids[key]).toBe('remainder_voided');
      }
      // The winner is not a void target and the remainder key is not a bidder.
      expect(out.journal.voids['b1']).toBeUndefined();
      assertFakeInvariants(rig.core);
    });
  }

  it('the remainder is looked at once, not on every run', async () => {
    const rig = makeRig(CEILINGS, { autoReleaseRemainder: false });
    await seed(rig);
    await runSettlement(rig.deps, 'auc1');
    const calls = rig.core.calls.length;
    await runSettlement(rig.deps, 'auc1');
    expect(rig.core.calls.length).toBe(calls);
  });

  it('a crash after the remainder void and a forgotten idempotency key still ends with one void', async () => {
    const rig = makeRig(CEILINGS, { autoReleaseRemainder: false });
    await seed(rig);
    let voidsDone = 0;
    const crash = (label: string): void => {
      if (label === 'after:void' && (voidsDone += 1) === 1) throw new Error('crash');
    };
    await expect(runSettlement({ ...rig.deps, boundary: crash }, 'auc1')).rejects.toThrow('crash');
    rig.core.forgetIdempotency();
    const out = await runSettlement(rig.deps, 'auc1');
    expect(out.status).toBe('settled');
    const b1 = rig.auth['b1'] ?? '';
    expect(rig.core.inspect(b1).voidEffects).toBe(1);
    expect(rig.core.released(b1) + rig.core.inspect(b1).capturedCents).toBe(30000);
    assertFakeInvariants(rig.core);
  });

  it('a read that fails leaves the phase pending and changes nothing', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    await runCapturePhase(rig.deps, 'auc1');
    rig.core.inject('get', 'http_500', rig.auth['b1'] ?? '', 1);
    const out = await runVoidPhase(rig.deps, 'auc1');
    expect(out).toMatchObject({ status: 'pending', reason: 'remainder_unavailable' });
    if (out.status !== 'pending') return;
    expect(out.journal.state).toBe('CAPTURED');
    expect((await runVoidPhase(rig.deps, 'auc1')).status).toBe('settled');
  });

  it('a capture that does not match the journal ends in FAILED_NEEDS_REVIEW', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    const done = await runCapturePhase(rig.deps, 'auc1');
    if (done.status !== 'captured') throw new Error('capture');
    // PayPal now shows a different captured total than the journal's winner.
    const b1 = rig.auth['b1'] ?? '';
    const lying = withGateway(rig, {
      getHoldTruth: async (h) => ({
        ...(await rig.gw.getHoldTruth(h)),
        capturedCents: h.authId === b1 ? 1 : 0,
      }),
    });
    expect(await releaseWinnerRemainder(lying, done.journal)).toEqual({ status: 'mismatch' });
    const out = await runVoidPhase(lying, 'auc1');
    expect(out).toMatchObject({ status: 'failed', reason: 'mismatch' });
    if (out.status !== 'failed') return;
    expect(out.journal.state).toBe('FAILED_NEEDS_REVIEW');
  });

  it('a void refused for another reason leaves the remainder to expire and still settles', async () => {
    const rig = makeRig(CEILINGS, { autoReleaseRemainder: false });
    await seed(rig);
    const b1 = rig.auth['b1'] ?? '';
    const deps = withGateway(rig, {
      voidAuthorization: async (a, r) => {
        if (a === b1) throw refusal();
        return rig.gw.voidAuthorization(a, r);
      },
    });
    const out = await runSettlement(deps, 'auc1');
    expect(out.status).toBe('settled');
    if (out.status !== 'settled') return;
    expect(out.journal.voids[remainderKey('b1')]).toBe('remainder_unreleased');
  });

  it('a void answered 422 PREVIOUSLY_CAPTURED (G1 sandbox) counts as released and settles', async () => {
    const rig = makeRig(CEILINGS, { autoReleaseRemainder: false });
    await seed(rig);
    const b1 = rig.auth['b1'] ?? '';
    const deps = withGateway(rig, {
      voidAuthorization: async (a, r) => {
        if (a === b1) {
          throw classifyError(
            422,
            {},
            '{"name":"UNPROCESSABLE_ENTITY","details":[{"issue":"PREVIOUSLY_CAPTURED"}]}',
          );
        }
        return rig.gw.voidAuthorization(a, r);
      },
    });
    const out = await runSettlement(deps, 'auc1');
    expect(out.status).toBe('settled');
    if (out.status !== 'settled') return;
    expect(out.journal.voids[remainderKey('b1')]).toBe('remainder_released');
  });
});
