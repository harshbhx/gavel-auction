import { describe, expect, it } from 'vitest';
import { canonicalJson, type Journal } from '../../src/types.js';
import { assertFakeInvariants } from '../../src/fake/invariants.js';
import { runCapturePhase } from '../../src/saga/capture.js';
import { newJournal } from '../../src/saga/create.js';
import { runSettlement, runVoidPhase, voidRequestId } from '../../src/saga/void.js';
import { CEILINGS, callsOf, makeRig, planFor, refusal, seed, withGateway } from './rig.js';

describe('T-PAY-035 no sale', () => {
  it('no candidates and three holds: three voids, SETTLED, winner null', async () => {
    const rig = makeRig(CEILINGS);
    await rig.journals.create(newJournal(planFor(rig, CEILINGS, [])));
    const out = await runSettlement(rig.deps, 'auc1');
    expect(out.status).toBe('settled');
    if (out.status !== 'settled') return;
    expect(out.journal.state).toBe('SETTLED');
    expect(out.journal.winner).toBeNull();
    expect(out.journal.history.map((h) => h.to)).toEqual([
      'BIDDING',
      'WINNER_SELECTED',
      'VOIDING',
      'SETTLED',
    ]);
    for (const b of Object.keys(CEILINGS)) {
      expect(rig.core.inspect(rig.auth[b] ?? '').voidEffects).toBe(1);
      expect(rig.core.released(rig.auth[b] ?? '')).toBe(CEILINGS[b as keyof typeof CEILINGS]);
    }
    expect(Object.keys(out.journal.voids).sort()).toEqual(['b1', 'b2', 'b3']);
    assertFakeInvariants(rig.core);
  });

  it('every candidate below the reserve is a no sale and every hold is voided', async () => {
    const rig = makeRig(CEILINGS);
    await rig.journals.create(
      newJournal(
        planFor(
          rig,
          CEILINGS,
          [
            ['b1', 4000],
            ['b2', 3000],
          ],
          0,
        ),
      ),
    );
    // The plan is valid at reserve 0; raise the reserve in the stored journal.
    const j = await rig.journals.load('auc1');
    if (j === null) throw new Error('journal');
    j.plan.reserveCents = 5000;
    j.version += 1;
    await rig.journals.save(j, j.version - 1);
    const out = await runSettlement(rig.deps, 'auc1');
    expect(out.status).toBe('settled');
    for (const b of Object.keys(CEILINGS)) {
      expect(rig.core.inspect(rig.auth[b] ?? '')).toMatchObject({
        capturedCents: 0,
        voidEffects: 1,
      });
    }
  });
});

describe('a sale', () => {
  it('captures the winner, voids the other two once and settles', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    const out = await runSettlement(rig.deps, 'auc1');
    expect(out.status).toBe('settled');
    if (out.status !== 'settled') return;
    expect(out.journal.winner?.bidderId).toBe('b1');
    expect(out.journal.voids['b2']).toBe('voided');
    expect(out.journal.voids['b3']).toBe('voided');
    expect(out.journal.voids['b1']).toBeUndefined();
    expect(rig.core.inspect(rig.auth['b1'] ?? '').voidEffects).toBe(0);
    expect(rig.core.inspect(rig.auth['b2'] ?? '').voidEffects).toBe(1);
    // Each void carries the hold's own request id.
    const voidCalls = rig.audits.filter((a) => a.kind === 'paypal_call' && a.op === 'void');
    expect(voidCalls.map((a) => a.requestId)).toEqual(
      expect.arrayContaining([voidRequestId('auc1', 'hold-b2'), voidRequestId('auc1', 'hold-b3')]),
    );
    assertFakeInvariants(rig.core);
  });

  it('running a settled settlement again changes nothing', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    await runSettlement(rig.deps, 'auc1');
    const before = rig.core.calls.length;
    expect((await runSettlement(rig.deps, 'auc1')).status).toBe('settled');
    expect(rig.core.calls.length).toBe(before);
  });

  it('answers busy while another runner holds the lease', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    await runCapturePhase(rig.deps, 'auc1');
    expect(await rig.journals.acquireLease('auc1', 'other', 30_000, 1_800_000_000_000)).toBe(true);
    expect(await runVoidPhase(rig.deps, 'auc1')).toEqual({ status: 'busy' });
  });

  it('is not ready before a winner is captured', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    const out = await runVoidPhase(rig.deps, 'auc1');
    expect(out).toMatchObject({ status: 'pending', reason: 'not_ready' });
    expect(rig.core.calls).toHaveLength(0);
  });

  it('never runs more voids at once than voidConcurrency', async () => {
    const many = { w: 30000, a: 20000, b: 20000, c: 20000, d: 20000, e: 20000 };
    const rig = makeRig(many);
    await seed(rig, [['w', 25000]], many);
    let live = 0;
    let peak = 0;
    const deps = withGateway(rig, {
      voidAuthorization: async (a, r) => {
        live += 1;
        peak = Math.max(peak, live);
        await new Promise((res) => setTimeout(res, 2));
        try {
          await rig.gw.voidAuthorization(a, r);
        } finally {
          live -= 1;
        }
      },
    });
    const out = await runSettlement({ ...deps, voidConcurrency: 2 }, 'auc1');
    expect(out.status).toBe('settled');
    expect(peak).toBe(2);
  });
});

describe('T-PAY-042 void outcomes', () => {
  it('a hold voided already, or expired, counts as released', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    rig.core.void(rig.auth['b2'] ?? ''); // buyer voided it in their account
    const out = await runSettlement(rig.deps, 'auc1');
    expect(out.status).toBe('settled');
    if (out.status !== 'settled') return;
    expect(out.journal.voids['b2']).toBe('released');
    expect(out.journal.voids['b3']).toBe('voided');
    expect(rig.core.inspect(rig.auth['b2'] ?? '').voidEffects).toBe(1);

    const exp = makeRig(CEILINGS);
    await seed(exp);
    await runCapturePhase(exp.deps, 'auc1');
    exp.clock.advance(30 * 24 * 3600 * 1000);
    exp.core.sweep();
    // b1 was captured before expiry; b2 and b3 expired by the clock.
    const out2 = await runVoidPhase(exp.deps, 'auc1');
    expect(out2.status).toBe('settled');
    if (out2.status !== 'settled') return;
    expect(out2.journal.voids).toMatchObject({ b2: 'released', b3: 'released' });
  });

  it('a server error on a void is pending, then the resume finishes it', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    rig.core.inject('void', 'http_500', rig.auth['b2'] ?? '', 1);
    const first = await runSettlement(rig.deps, 'auc1');
    expect(first).toMatchObject({ status: 'pending', reason: 'void_incomplete' });
    if (first.status !== 'pending') return;
    expect(first.journal.state).toBe('VOIDING');
    expect(first.journal.voids['b2']).toBe('pending');
    expect(first.journal.voids['b3']).toBe('voided');

    const second = await runSettlement(rig.deps, 'auc1');
    expect(second.status).toBe('settled');
    if (second.status !== 'settled') return;
    expect(second.journal.resumes).toBe(0);
    expect(rig.core.inspect(rig.auth['b2'] ?? '').voidEffects).toBe(1);
    assertFakeInvariants(rig.core);
  });

  it('a void refused on a live hold is retried once, then recorded VOID_FAILED', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    const b2 = rig.auth['b2'] ?? '';
    let tries = 0;
    const deps = withGateway(rig, {
      voidAuthorization: async (a, r) => {
        if (a !== b2) return rig.gw.voidAuthorization(a, r);
        tries += 1;
        throw refusal();
      },
    });
    const out = await runSettlement(deps, 'auc1');
    expect(out).toMatchObject({ status: 'pending', reason: 'void_incomplete' });
    if (out.status !== 'pending') return;
    expect(tries).toBe(2);
    expect(out.journal.voids['b2']).toBe('VOID_FAILED');
    expect(out.journal.voids['b3']).toBe('voided');
    expect(callsOf(rig, b2, 'get')).toBeGreaterThanOrEqual(2);
  });

  it('after five resumes it goes to FAILED_NEEDS_REVIEW with void_failed:<bidder>', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    const b2 = rig.auth['b2'] ?? '';
    const deps = withGateway(rig, {
      voidAuthorization: async (a, r) => {
        if (a === b2) throw refusal();
        return rig.gw.voidAuthorization(a, r);
      },
    });
    // The first run plus five resumes all leave the hold failed.
    for (let i = 0; i < 6; i += 1) {
      const out = await runSettlement(deps, 'auc1');
      expect(out).toMatchObject({ status: 'pending', reason: 'void_incomplete' });
    }
    const last = await runSettlement(deps, 'auc1');
    expect(last).toMatchObject({ status: 'failed', reason: 'void_failed:b2' });
    if (last.status !== 'failed') return;
    expect(last.journal.state).toBe('FAILED_NEEDS_REVIEW');
    expect(last.journal.resumes).toBe(5);
    expect(last.journal.history.at(-1)?.label).toBe('journaled:void_failed:b2');
    // The winner stays charged; the live hold is the reviewer's to clear.
    expect(rig.core.inspect(rig.auth['b1'] ?? '').capturedCents).toBe(22000);
    // Asking again is stable.
    expect(await runSettlement(deps, 'auc1')).toMatchObject({ status: 'failed' });
  });

  it('a configured maxVoidResumes of 1 gives up after one resume', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    const b3 = rig.auth['b3'] ?? '';
    const deps = {
      ...withGateway(rig, {
        voidAuthorization: async (a, r) => {
          if (a === b3) throw refusal();
          return rig.gw.voidAuthorization(a, r);
        },
      }),
      maxVoidResumes: 1,
    };
    expect((await runSettlement(deps, 'auc1')).status).toBe('pending');
    expect((await runSettlement(deps, 'auc1')).status).toBe('pending');
    expect(await runSettlement(deps, 'auc1')).toMatchObject({
      status: 'failed',
      reason: 'void_failed:b3',
    });
  });
});

describe('crash and resume in the void phase (T-PAY-044 shape)', () => {
  /** Canonical bytes of a journal, ignoring the resume counter, timestamps and capture-or-adopt labels. */
  function shape(j: Journal | null): string {
    if (j === null) throw new Error('no journal');
    const copy = structuredClone(j);
    copy.resumes = 0;
    copy.history = copy.history.map((h) => ({ ...h, tsMs: 0, label: '' }));
    return canonicalJson(copy);
  }

  it('crashing at every boundary and resuming gives the uninterrupted journal', async () => {
    const dry = makeRig(CEILINGS);
    await seed(dry);
    const labels: string[] = [];
    await runSettlement(
      {
        ...dry.deps,
        boundary: (l) => {
          labels.push(l);
        },
      },
      'auc1',
    );
    const clean = await dry.journals.load('auc1');
    expect(labels.length).toBeGreaterThan(8);
    expect(labels).toContain('before:void');
    expect(labels).toContain('journaled:void_b2');

    for (let at = 0; at < labels.length; at += 1) {
      const rig = makeRig(CEILINGS);
      await seed(rig);
      let n = 0;
      const crash = (): void => {
        if (n++ === at) throw new Error(`crash at ${at}`);
      };
      await expect(runSettlement({ ...rig.deps, boundary: crash }, 'auc1')).rejects.toThrow(
        'crash',
      );
      const out = await runSettlement(rig.deps, 'auc1');
      expect(out.status, `after a crash at ${labels[at]}`).toBe('settled');
      expect(shape(await rig.journals.load('auc1'))).toBe(shape(clean));
      for (const b of ['b2', 'b3']) {
        expect(rig.core.inspect(rig.auth[b] ?? '').voidEffects).toBe(1);
      }
      expect(rig.core.inspect(rig.auth['b1'] ?? '').capturedCents).toBe(22000);
      assertFakeInvariants(rig.core);
    }
  });
});
