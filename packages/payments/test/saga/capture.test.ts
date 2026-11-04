import { beforeEach, describe, expect, it } from 'vitest';
import { PayPalError } from '../../src/errors.js';
import { FakeClock, FakePayPalCore } from '../../src/fake/core.js';
import { FakeGateway } from '../../src/fake/gateway.js';
import { assertFakeInvariants } from '../../src/fake/invariants.js';
import { guardGateway } from '../../src/killswitch.js';
import { createMetrics } from '../../src/metrics.js';
import type { KillSwitch, PaymentsGateway } from '../../src/ports.js';
import { buildRequestId } from '../../src/requestId.js';
import {
  CapturePhase,
  invoiceIdFor,
  runCapturePhase,
  verdict,
  type CaptureDeps,
} from '../../src/saga/capture.js';
import { SettlementError, createSettlement, newJournal } from '../../src/saga/create.js';
import { MemoryJournalStore } from '../../src/stores/memory.js';
import type { HoldTruth, PaymentAudit, SettlementPlan } from '../../src/types.js';

const START_MS = 1_800_000_000_000;

interface Rig {
  clock: FakeClock;
  core: FakePayPalCore;
  gw: PaymentsGateway;
  journals: MemoryJournalStore;
  audits: PaymentAudit[];
  auth: Record<string, string>;
  deps: CaptureDeps;
}

/** Holds with these ceilings (cents), one authorization each at the fake. */
function makeRig(ceilings: Record<string, number>, over: Partial<CaptureDeps> = {}): Rig {
  const clock = new FakeClock(START_MS);
  const core = new FakePayPalCore({ clock });
  const gw = new FakeGateway(core);
  const journals = new MemoryJournalStore();
  const audits: PaymentAudit[] = [];
  const auth: Record<string, string> = {};
  for (const [bidder, cents] of Object.entries(ceilings)) {
    auth[bidder] = core.createAuthorization(`payer-${bidder}`, cents).id;
  }
  const deps: CaptureDeps = {
    journals,
    gateway: gw,
    audit: { append: async (e) => void audits.push(e) },
    clock: { nowMs: () => clock.nowMs() },
    ...over,
  };
  return { clock, core, gw, journals, audits, auth, deps };
}

function planFor(
  rig: Rig,
  ceilings: Record<string, number>,
  candidates: Array<[string, number]>,
  reserveCents = 5000,
): SettlementPlan {
  const holds: SettlementPlan['holds'] = {};
  for (const [bidder, ceilingCents] of Object.entries(ceilings)) {
    holds[bidder] = {
      holdId: `hold-${bidder}`,
      authId: rig.auth[bidder] ?? '',
      ceilingCents,
      createdAtMs: START_MS,
    };
  }
  return {
    auctionId: 'auc1',
    reserveCents,
    candidates: candidates.map(([bidderId, priceCents]) => ({ bidderId, priceCents })),
    holds,
  };
}

const CEILINGS = { b1: 30000, b2: 25000, b3: 20000 };

async function standard(rig: Rig): Promise<void> {
  await createSettlement(
    { journals: rig.journals },
    planFor(rig, CEILINGS, [
      ['b1', 22000],
      ['b2', 21000],
      ['b3', 20000],
    ]),
  );
}

function withGateway(rig: Rig, patch: Partial<PaymentsGateway>): CaptureDeps {
  return { ...rig.deps, gateway: { ...rig.gw, ...patch } };
}

function callsTo(rig: Rig, authId: string): number {
  return rig.core.calls.filter((c) => c.id === authId).length;
}

describe('T-PAY-033 capture at the winning price', () => {
  it('captures the winner final at the planned price and reaches CAPTURED', async () => {
    const metrics = createMetrics();
    const rig = makeRig(CEILINGS, { metrics });
    await standard(rig);

    const out = await runCapturePhase(rig.deps, 'auc1');
    expect(out.status).toBe('captured');
    if (out.status !== 'captured') return;
    expect(out.journal.state).toBe('CAPTURED');
    expect(out.journal.winner).toMatchObject({
      bidderId: 'b1',
      holdId: 'hold-b1',
      amountCents: 22000,
    });
    expect(out.journal.intent).toBeNull();
    expect(out.journal.unknownSince).toBeNull();
    expect(out.journal.history.map((h) => h.to)).toEqual([
      'BIDDING',
      'WINNER_SELECTED',
      'CAPTURING',
      'CAPTURED',
    ]);

    const a1 = rig.core.getAuthorization(rig.auth['b1'] ?? '');
    expect(a1.status).toBe('CAPTURED');
    expect(a1.captures).toHaveLength(1);
    expect(a1.captures[0]).toMatchObject({ amountCents: 22000, final: true });
    expect(a1.captureRequestIds[0]).toBe(
      buildRequestId({
        auctionId: 'auc1',
        op: 'capture',
        holdId: 'hold-b1',
        amountCents: 22000,
        generation: 0,
      }),
    );
    // The other holds are not touched; voiding them is the next phase.
    for (const b of ['b2', 'b3']) {
      expect(rig.core.inspect(rig.auth[b] ?? '')).toMatchObject({
        capturedCents: 0,
        voidEffects: 0,
      });
      expect(callsTo(rig, rig.auth[b] ?? '')).toBe(0);
    }
    assertFakeInvariants(rig.core);

    expect(metrics.counter('settlement_transitions_total', { to: 'CAPTURED' })).toBe(1);
    const call = rig.audits.find((a) => a.kind === 'paypal_call');
    expect(call).toMatchObject({ op: 'capture', holdId: 'hold-b1', outcome: 'definite' });
    expect(invoiceIdFor('auc1', 'hold-b1')).toBe('gavel-auc1-hold-b1');
  });

  it('running a captured settlement again changes nothing', async () => {
    const rig = makeRig(CEILINGS);
    await standard(rig);
    await runCapturePhase(rig.deps, 'auc1');
    const callsBefore = rig.core.calls.length;
    const again = await runCapturePhase(rig.deps, 'auc1');
    expect(again.status).toBe('captured');
    expect(rig.core.calls.length).toBe(callsBefore);
  });

  it('answers busy while another runner holds the lease', async () => {
    const rig = makeRig(CEILINGS);
    await standard(rig);
    expect(await rig.journals.acquireLease('auc1', 'other', 30_000, START_MS)).toBe(true);
    expect(await runCapturePhase(rig.deps, 'auc1')).toEqual({ status: 'busy' });
    expect(rig.core.calls.length).toBe(0);
  });
});

describe('T-PAY-034 invariants before any PayPal call', () => {
  async function direct(rig: Rig, candidates: Array<[string, number]>, reserve = 5000) {
    await rig.journals.create(newJournal(planFor(rig, CEILINGS, candidates, reserve)));
  }

  it('a price above the hold ceiling goes to FAILED_NEEDS_REVIEW with zero calls', async () => {
    const rig = makeRig(CEILINGS);
    await direct(rig, [['b1', 30001]]);
    const out = await runCapturePhase(rig.deps, 'auc1');
    expect(out).toMatchObject({ status: 'failed', reason: 'invariant' });
    expect(out.status === 'failed' && out.journal.state).toBe('FAILED_NEEDS_REVIEW');
    expect(rig.core.calls).toHaveLength(0);
  });

  it('a price of 0, a negative price and a fractional price are refused the same way', async () => {
    for (const price of [0, -100, 1.5]) {
      const rig = makeRig(CEILINGS);
      await direct(rig, [['b1', price]], 0);
      const out = await runCapturePhase(rig.deps, 'auc1');
      expect(out).toMatchObject({ status: 'failed', reason: 'invariant' });
      expect(rig.core.calls).toHaveLength(0);
    }
  });

  it('a candidate below the reserve is skipped, the next one is captured', async () => {
    const rig = makeRig(CEILINGS);
    await direct(rig, [
      ['b1', 4000],
      ['b2', 6000],
    ]);
    const out = await runCapturePhase(rig.deps, 'auc1');
    expect(out.status).toBe('captured');
    if (out.status !== 'captured') return;
    expect(out.journal.winner).toMatchObject({ bidderId: 'b2', amountCents: 6000 });
    expect(out.journal.failed).toEqual([{ bidderId: 'b1', reason: 'below_reserve' }]);
    expect(out.journal.cursor).toBe(1);
    expect(callsTo(rig, rig.auth['b1'] ?? '')).toBe(0);
    assertFakeInvariants(rig.core);
  });

  it('every candidate below the reserve is no sale, with zero calls', async () => {
    const rig = makeRig(CEILINGS);
    await direct(rig, [
      ['b1', 4000],
      ['b2', 3000],
    ]);
    const out = await runCapturePhase(rig.deps, 'auc1');
    expect(out.status).toBe('no_sale');
    expect(out.status === 'no_sale' && out.journal.state).toBe('VOIDING');
    expect(rig.core.calls).toHaveLength(0);
  });

  it('a settlement without candidates is no sale', async () => {
    const rig = makeRig(CEILINGS);
    await direct(rig, []);
    const out = await runCapturePhase(rig.deps, 'auc1');
    expect(out.status).toBe('no_sale');
    expect(rig.core.calls).toHaveLength(0);
  });

  it('a plan with such a price is refused when it is created', async () => {
    const rig = makeRig(CEILINGS);
    await expect(
      createSettlement({ journals: rig.journals }, planFor(rig, CEILINGS, [['b1', 30001]])),
    ).rejects.toBeInstanceOf(SettlementError);
    expect(await rig.journals.load('auc1')).toBeNull();
  });
});

describe('definite failure (R-PAY-053)', () => {
  it('a declined capture falls back to the runner-up after the truth says not captured', async () => {
    const rig = makeRig(CEILINGS);
    await standard(rig);
    rig.core.inject('capture', 'capture_declined');
    const out = await runCapturePhase(rig.deps, 'auc1');
    expect(out.status).toBe('captured');
    if (out.status !== 'captured') return;
    expect(out.journal.winner).toMatchObject({ bidderId: 'b2', amountCents: 21000 });
    expect(out.journal.failed).toEqual([{ bidderId: 'b1', reason: 'declined' }]);
    expect(out.journal.history.map((h) => h.to)).toEqual([
      'BIDDING',
      'WINNER_SELECTED',
      'CAPTURING',
      'FALLBACK_RUNNER_UP',
      'CAPTURING',
      'CAPTURED',
    ]);
    expect(rig.core.inspect(rig.auth['b1'] ?? '').capturedCents).toBe(0);
    expect(rig.core.inspect(rig.auth['b2'] ?? '').capturedCents).toBe(21000);
    assertFakeInvariants(rig.core);
  });

  it('a refusal while the truth shows the capture adopts it instead of falling back', async () => {
    const rig = makeRig(CEILINGS);
    await standard(rig);
    const deps = withGateway(rig, {
      capture: async (authId, i) => {
        await rig.gw.capture(authId, i);
        throw new PayPalError({
          kind: 'declined',
          status: 422,
          name: 'UNPROCESSABLE_ENTITY',
          message: 'declined',
          outcome: 'definite',
        });
      },
    });
    const out = await runCapturePhase(deps, 'auc1');
    expect(out.status).toBe('captured');
    if (out.status !== 'captured') return;
    expect(out.journal.winner).toMatchObject({ bidderId: 'b1', amountCents: 22000 });
    expect(out.journal.failed).toEqual([]);
    expect(rig.core.inspect(rig.auth['b2'] ?? '').capturedCents).toBe(0);
    assertFakeInvariants(rig.core);
  });

  it('a hold that PayPal no longer has moves on without capturing it', async () => {
    const rig = makeRig(CEILINGS);
    await standard(rig);
    await rig.gw.voidAuthorization(rig.auth['b1'] ?? '', 'r-void');
    const out = await runCapturePhase(rig.deps, 'auc1');
    expect(out.status).toBe('captured');
    expect(out.status === 'captured' && out.journal.winner?.bidderId).toBe('b2');
    expect(out.status === 'captured' && out.journal.failed[0]?.reason).toBe('hold_voided');
  });

  it('a bad request is an invariant failure, not a reason to try the next candidate', async () => {
    const rig = makeRig(CEILINGS);
    await standard(rig);
    const deps = withGateway(rig, {
      capture: async () => {
        throw new PayPalError({
          kind: 'invalid_request',
          status: 400,
          name: 'INVALID_REQUEST',
          message: 'bad',
          outcome: 'definite',
        });
      },
    });
    const out = await runCapturePhase(deps, 'auc1');
    expect(out).toMatchObject({ status: 'failed', reason: 'invariant' });
    expect(callsTo(rig, rig.auth['b2'] ?? '')).toBe(0);
  });

  it('without a readable truth a definite refusal does not fall back', async () => {
    const rig = makeRig(CEILINGS);
    await standard(rig);
    let reads = 0;
    const deps = withGateway(rig, {
      getHoldTruth: async (h) => {
        reads += 1;
        if (reads === 1) return rig.gw.getHoldTruth(h);
        throw new PayPalError({
          kind: 'network',
          status: 0,
          name: 'NETWORK_ERROR',
          message: 'read failed',
          outcome: 'unknown',
        });
      },
    });
    rig.core.inject('capture', 'capture_declined');
    const out = await runCapturePhase(deps, 'auc1');
    expect(out).toMatchObject({ status: 'pending', reason: 'truth_unavailable' });
    expect(out.status === 'pending' && out.journal.state).toBe('CAPTURING');
    expect(callsTo(rig, rig.auth['b2'] ?? '')).toBe(0);
  });
});

describe('unknown outcome (R-PAY-054, R-PAY-055)', () => {
  it('never moves to the next candidate, and a resume reuses the intent and captures once', async () => {
    const rig = makeRig(CEILINGS);
    await standard(rig);
    rig.core.inject('capture', 'timeout_before');
    const first = await runCapturePhase(rig.deps, 'auc1');
    expect(first).toMatchObject({ status: 'pending', reason: 'capture_outcome_unknown' });
    if (first.status !== 'pending') return;
    expect(first.journal.state).toBe('CAPTURING');
    expect(first.journal.unknownSince).toBe(START_MS);
    const intent = first.journal.intent;
    expect(intent).toMatchObject({ op: 'capture', holdId: 'hold-b1', amountCents: 22000 });
    expect(callsTo(rig, rig.auth['b2'] ?? '')).toBe(0);

    rig.clock.advance(5000);
    const second = await runCapturePhase(rig.deps, 'auc1');
    expect(second.status).toBe('captured');
    if (second.status !== 'captured') return;
    expect(second.journal.winner?.bidderId).toBe('b1');
    expect(second.journal.unknownSince).toBeNull();
    expect(rig.core.getAuthorization(rig.auth['b1'] ?? '').captureRequestIds).toEqual([
      intent?.requestId,
    ]);
    assertFakeInvariants(rig.core);
  });

  it('a capture that took effect before the answer was lost is adopted, not repeated', async () => {
    const rig = makeRig(CEILINGS);
    await standard(rig);
    rig.core.inject('capture', 'timeout_after_success');
    const first = await runCapturePhase(rig.deps, 'auc1');
    expect(first).toMatchObject({ status: 'pending', reason: 'capture_outcome_unknown' });
    const second = await runCapturePhase(rig.deps, 'auc1');
    expect(second.status).toBe('captured');
    expect(second.status === 'captured' && second.journal.winner?.amountCents).toBe(22000);
    expect(rig.core.getAuthorization(rig.auth['b1'] ?? '').captures).toHaveLength(1);
    expect(callsTo(rig, rig.auth['b2'] ?? '')).toBe(0);
    assertFakeInvariants(rig.core);
  });

  it('after the deadline the settlement needs review, with no fallback and no voids', async () => {
    const rig = makeRig(CEILINGS, { unknownDeadlineMs: 600_000 });
    await standard(rig);
    rig.core.inject('capture', 'timeout_before', null, 5);
    expect((await runCapturePhase(rig.deps, 'auc1')).status).toBe('pending');
    rig.clock.advance(600_001);
    const out = await runCapturePhase(rig.deps, 'auc1');
    expect(out).toMatchObject({ status: 'failed', reason: 'unknown_deadline' });
    expect(out.status === 'failed' && out.journal.state).toBe('FAILED_NEEDS_REVIEW');
    for (const b of ['b2', 'b3']) expect(callsTo(rig, rig.auth[b] ?? '')).toBe(0);
    expect(rig.core.inspect(rig.auth['b1'] ?? '').voidEffects).toBe(0);
  });

  it('before the deadline it stays pending', async () => {
    const rig = makeRig(CEILINGS, { unknownDeadlineMs: 600_000 });
    await standard(rig);
    rig.core.inject('capture', 'timeout_before', null, 5);
    await runCapturePhase(rig.deps, 'auc1');
    rig.clock.advance(599_000);
    expect(await runCapturePhase(rig.deps, 'auc1')).toMatchObject({ status: 'pending' });
  });
});

describe('mismatching truth', () => {
  it('a capture on the hold that is not the planned one needs review, nothing is captured', async () => {
    const rig = makeRig(CEILINGS);
    await standard(rig);
    rig.core.capture(rig.auth['b1'] ?? '', 5000, false, 'foreign');
    const out = await runCapturePhase(rig.deps, 'auc1');
    expect(out).toMatchObject({ status: 'failed', reason: 'mismatch' });
    expect(rig.core.inspect(rig.auth['b1'] ?? '').capturedCents).toBe(5000);
  });

  it('a hold whose captures cannot be listed is not guessed at', () => {
    const base: HoldTruth = {
      holdId: 'h',
      authId: 'a',
      status: 'CAPTURED',
      amountCents: 100,
      capturedCents: 0,
      captures: null,
      observedAtMs: 0,
    };
    expect(verdict(base, 100, 'inv').kind).toBe('mismatch');
    expect(verdict({ ...base, status: 'CREATED' }, 100, 'inv').kind).toBe('open');
  });

  it('adopts only a final capture of the planned amount and invoice', () => {
    const t: HoldTruth = {
      holdId: 'h',
      authId: 'a',
      status: 'CAPTURED',
      amountCents: 500,
      capturedCents: 300,
      captures: [{ captureId: 'C1', amountCents: 300, final: true, invoiceId: 'inv' }],
      observedAtMs: 0,
    };
    expect(verdict(t, 300, 'inv').kind).toBe('adopt');
    expect(verdict(t, 301, 'inv').kind).toBe('mismatch');
    expect(verdict(t, 300, 'other').kind).toBe('mismatch');
    const partial = { ...t, captures: [{ captureId: 'C1', amountCents: 300, final: false }] };
    expect(verdict(partial, 300, 'inv').kind).toBe('mismatch');
  });
});

describe('kill switch (R-PAY-063)', () => {
  function switchOf(state: { on: boolean }): KillSwitch {
    return {
      isEngaged: async () => (state.on ? { engaged: true, reason: 'test' } : { engaged: false }),
      engage: async () => undefined,
      release: async () => undefined,
    };
  }

  it('stops before the capture, keeps the state, and continues once released', async () => {
    const state = { on: true };
    const rig = makeRig(CEILINGS, { killSwitch: switchOf(state) });
    await standard(rig);
    const out = await runCapturePhase(rig.deps, 'auc1');
    expect(out).toMatchObject({ status: 'pending', reason: 'kill_switch' });
    expect(out.status === 'pending' && out.journal.state).toBe('CAPTURING');
    expect(rig.core.calls.every((c) => c.op === 'get')).toBe(true);
    state.on = false;
    expect((await runCapturePhase(rig.deps, 'auc1')).status).toBe('captured');
    assertFakeInvariants(rig.core);
  });

  it('a gateway that refuses the capture gives the same answer', async () => {
    const state = { on: false };
    const rig = makeRig(CEILINGS);
    await standard(rig);
    const guarded = guardGateway(rig.gw, switchOf(state));
    state.on = true;
    const deps = { ...rig.deps, gateway: guarded };
    expect(await runCapturePhase(deps, 'auc1')).toMatchObject({
      status: 'pending',
      reason: 'kill_switch',
    });
    expect(rig.core.calls.every((c) => c.op === 'get')).toBe(true);
  });
});

describe('crash and resume (R-PAY-060)', () => {
  /** Labels the run passes, in order, for the standard settlement. */
  async function labels(): Promise<string[]> {
    const seen: string[] = [];
    const rig = makeRig(CEILINGS, { boundary: (l) => void seen.push(l) });
    await standard(rig);
    await runCapturePhase(rig.deps, 'auc1');
    return seen;
  }

  let all: string[];
  beforeEach(async () => {
    all = await labels();
  });

  it('visits the boundaries of the capture path', () => {
    expect(all).toEqual(
      expect.arrayContaining([
        'journaled:start_auction',
        'journaled:begin',
        'before:get',
        'after:get',
        'journaled:intent',
        'before:capture',
        'after:capture',
        'journaled:capture_ok',
      ]),
    );
  });

  it('a crash at any boundary, then a resume, ends in the same state with one capture', async () => {
    for (let i = 0; i < all.length; i += 1) {
      let n = 0;
      const rig = makeRig(CEILINGS, {
        boundary: (label) => {
          if (n++ === i) throw new Error(`crash at ${label}`);
        },
      });
      await standard(rig);
      await expect(runCapturePhase(rig.deps, 'auc1')).rejects.toThrow(/crash at/);

      const resumed = await new CapturePhase({ ...rig.deps, boundary: () => undefined }).run(
        'auc1',
      );
      expect(resumed.status, `crash at ${all[i]}`).toBe('captured');
      if (resumed.status !== 'captured') continue;
      expect(resumed.journal.winner).toMatchObject({ bidderId: 'b1', amountCents: 22000 });
      const a1 = rig.core.getAuthorization(rig.auth['b1'] ?? '');
      expect(a1.captures, `crash at ${all[i]}`).toHaveLength(1);
      expect(rig.core.inspect(rig.auth['b2'] ?? '').capturedCents).toBe(0);
      assertFakeInvariants(rig.core);
    }
  });
});
