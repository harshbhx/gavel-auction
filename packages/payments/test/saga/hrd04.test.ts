import { describe, expect, it } from 'vitest';
import { PayPalError } from '../../src/errors.js';
import { assertFakeInvariants } from '../../src/fake/invariants.js';
import { runCapturePhase } from '../../src/saga/capture.js';
import { runLeaseOwner } from '../../src/saga/owner.js';
import { CEILINGS, makeRig, seed, withGateway } from './rig.js';

function httpError(status: number, name: string): PayPalError {
  return new PayPalError({
    kind: 'rejected',
    status,
    name,
    message: 'refused',
    outcome: 'definite',
  });
}

describe('HRD-04 an unclassified capture refusal never walks down the candidates', () => {
  for (const [status, name] of [
    [403, 'HTTP_403'],
    [422, 'UNPROCESSABLE_ENTITY'],
  ] as const) {
    it(`status ${status} stops the capture phase, keeps every hold and tries one capture`, async () => {
      const rig = makeRig(CEILINGS);
      await seed(rig);
      const attempted: string[] = [];
      const deps = withGateway(rig, {
        capture: async (authId) => {
          attempted.push(authId);
          throw httpError(status, name);
        },
      });
      const out = await runCapturePhase(deps, 'auc1');
      expect(out).toMatchObject({ status: 'pending', reason: 'capture_rejected_unclassified' });
      expect(attempted).toEqual([rig.auth['b1']]);
      if (out.status !== 'pending') return;
      expect(out.journal.failed).toEqual([]);
      expect(out.journal.winner).toBeNull();
      for (const id of Object.values(rig.auth)) {
        expect(rig.core.inspect(id)).toMatchObject({ capturedCents: 0, voidEffects: 0 });
      }
      assertFakeInvariants(rig.core);
    });
  }

  it('a refusal that names the hold still falls back to the next candidate', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    rig.core.inject('capture', 'capture_declined', rig.auth['b1'] ?? '', 1);
    const out = await runCapturePhase(rig.deps, 'auc1');
    expect(out.status).toBe('captured');
    if (out.status !== 'captured') return;
    expect(out.journal.failed).toEqual([{ bidderId: 'b1', reason: 'declined' }]);
    expect(out.journal.winner).toMatchObject({ bidderId: 'b2' });
  });
});

describe('HRD-04 the default lease owner is unique per run', () => {
  it('gives each run its own owner under the same base', () => {
    const a = runLeaseOwner('runner-x');
    const b = runLeaseOwner('runner-x');
    expect(a).not.toBe(b);
    expect(a.startsWith('runner-x-run-')).toBe(true);
  });

  it('a second run of the same phase in one process is busy and cannot free the first lease', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    let entered: () => void = () => undefined;
    const inCapture = new Promise<void>((r) => {
      entered = r;
    });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const deps = withGateway(rig, {
      capture: async (authId, i) => {
        entered();
        await gate;
        return rig.gw.capture(authId, i);
      },
    });
    const first = runCapturePhase(deps, 'auc1');
    await inCapture;
    expect(await runCapturePhase(deps, 'auc1')).toEqual({ status: 'busy' });
    // Still busy after the second run finished: its release did not free the first lease.
    expect(await runCapturePhase(deps, 'auc1')).toEqual({ status: 'busy' });
    release();
    const out = await first;
    expect(out.status).toBe('captured');
    assertFakeInvariants(rig.core);
  });
});
