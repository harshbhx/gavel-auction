import { describe, expect, it } from 'vitest';
import { PayPalError } from '../../src/errors.js';
import { FakeClock, FakePayPalCore } from '../../src/fake/core.js';
import { FakeGateway } from '../../src/fake/gateway.js';
import type { PaymentsGateway } from '../../src/ports.js';
import { buildRequestId } from '../../src/requestId.js';
import {
  reconcileAll,
  reconcileWithRepair,
  startReconcileTimer,
  type RepairDeps,
} from '../../src/reconcile/repair.js';
import { MemoryHoldStore, MemoryJournalStore } from '../../src/stores/memory.js';
import type { Journal, PaymentAudit } from '../../src/types.js';

const T0 = 1_800_000_000_000;
const AUCTION = 'A1';

interface Rig {
  core: FakePayPalCore;
  deps: RepairDeps;
  audits: PaymentAudit[];
  auth: { b1: string; b2: string };
}

async function makeRig(patch: Partial<PaymentsGateway> = {}): Promise<Rig> {
  const clock = new FakeClock(T0);
  const core = new FakePayPalCore({ clock });
  const base = new FakeGateway(core);
  const b1 = core.createAuthorization('p1', 30000).id;
  const b2 = core.createAuthorization('p2', 25000).id;
  core.capture(b1, 22000, true);
  const journal: Journal = {
    v: 1,
    auctionId: AUCTION,
    version: 3,
    state: 'SETTLED',
    plan: {
      reserveCents: 5000,
      candidates: [
        { bidderId: 'b1', priceCents: 22000 },
        { bidderId: 'b2', priceCents: 21000 },
      ],
    },
    holds: {
      b1: { holdId: 'h1', authId: b1, ceilingCents: 30000, stale: false },
      b2: { holdId: 'h2', authId: b2, ceilingCents: 25000, stale: false },
    },
    cursor: 0,
    intent: null,
    unknownSince: null,
    winner: { bidderId: 'b1', holdId: 'h1', captureId: 'C1', amountCents: 22000 },
    failed: [],
    voids: {},
    resumes: 0,
    history: [],
  };
  const journals = new MemoryJournalStore();
  await journals.create(journal);
  const holds = new MemoryHoldStore();
  await holds.put({
    holdId: 'h1',
    auctionId: AUCTION,
    bidderId: 'b1',
    orderId: 'O1',
    authId: b1,
    ceilingCents: 30000,
    status: 'CAPTURED',
    createdAtMs: T0,
  });
  await holds.put({
    holdId: 'h2',
    auctionId: AUCTION,
    bidderId: 'b2',
    orderId: 'O2',
    authId: b2,
    ceilingCents: 25000,
    status: 'HELD',
    createdAtMs: T0,
  });
  const audits: PaymentAudit[] = [];
  const gateway: PaymentsGateway = {
    createOrder: (i) => base.createOrder(i),
    getOrder: (id) => base.getOrder(id),
    authorizeOrder: (id, r) => base.authorizeOrder(id, r),
    getHoldTruth: (h) => base.getHoldTruth(h),
    capture: (a, i) => base.capture(a, i),
    voidAuthorization: (a, r) => base.voidAuthorization(a, r),
    reauthorize: (a, i) => base.reauthorize(a, i),
    ...patch,
  };
  return {
    core,
    auth: { b1, b2 },
    audits,
    deps: {
      gateway,
      journals,
      holds,
      clock: { nowMs: () => clock.nowMs() },
      audit: { append: async (e) => void audits.push(e) },
    },
  };
}

const callsOn = (rig: Rig, authId: string, op: string): number =>
  rig.core.calls.filter((c) => c.id === authId && c.op === op).length;

describe('T-PAY-072 reconciler repair', () => {
  it('without repair a live hold after SETTLED is reported and left alone', async () => {
    const rig = await makeRig();
    const r = await reconcileWithRepair(rig.deps, AUCTION);
    expect(r.findings.map((f) => f.code)).toEqual(['LIVE_HOLD_AFTER_SETTLED']);
    expect(r.repairs).toEqual([]);
    expect(callsOn(rig, rig.auth.b2, 'void')).toBe(0);
    expect(rig.core.getAuthorization(rig.auth.b2).status).toBe('CREATED');
  });

  it('with void_live_holds the hold is voided, nothing is captured, the winner is untouched', async () => {
    const rig = await makeRig();
    const before = rig.core.calls.filter((c) => c.op === 'capture').length;
    const r = await reconcileWithRepair(rig.deps, AUCTION, { repair: 'void_live_holds' });
    expect(r.findings.map((f) => f.code)).toEqual(['LIVE_HOLD_AFTER_SETTLED']);
    expect(r.repairs).toEqual([{ holdId: 'h2', bidderId: 'b2', result: 'voided' }]);
    expect(rig.core.getAuthorization(rig.auth.b2).status).toBe('VOIDED');
    expect(callsOn(rig, rig.auth.b1, 'void')).toBe(0);
    expect(rig.core.calls.filter((c) => c.op === 'capture')).toHaveLength(before);
    expect(rig.audits.filter((a) => a.label === 'void_live_hold')).toHaveLength(1);
    // The journal's money fields are as they were.
    const j = await rig.deps.journals.load(AUCTION);
    expect(j?.winner?.amountCents).toBe(22000);
    expect(j?.version).toBe(3);
  });

  it('a second run finds nothing to repair', async () => {
    const rig = await makeRig();
    await reconcileWithRepair(rig.deps, AUCTION, { repair: 'void_live_holds' });
    const again = await reconcileWithRepair(rig.deps, AUCTION, { repair: 'void_live_holds' });
    // The stale hold record is still reported as drift, but nothing is live and nothing is voided.
    expect(again.findings.map((f) => f.code)).not.toContain('LIVE_HOLD_AFTER_SETTLED');
    expect(again.repairs).toEqual([]);
    expect(callsOn(rig, rig.auth.b2, 'void')).toBe(1);
  });

  it('a void that PayPal refuses is reported as failed and does not throw', async () => {
    const rig = await makeRig({
      voidAuthorization: async () => {
        throw new PayPalError({
          kind: 'server_error',
          status: 500,
          name: 'X',
          message: 'down',
          outcome: 'unknown',
        });
      },
    });
    const r = await reconcileWithRepair(rig.deps, AUCTION, { repair: 'void_live_holds' });
    expect(r.repairs).toEqual([
      { holdId: 'h2', bidderId: 'b2', result: 'failed', detail: 'server_error' },
    ]);
    // RT4-saga-04: the refused call is in the trail with its outcome.
    expect(rig.audits.filter((a) => a.kind === 'paypal_call')).toEqual([
      expect.objectContaining({
        op: 'void',
        holdId: 'h2',
        outcome: 'unknown',
        status: 500,
        label: 'server_error',
      }),
    ]);
  });

  it('writes the paypal_call row of the repair void before its state change (RT4-saga-04)', async () => {
    const rig = await makeRig();
    await reconcileWithRepair(rig.deps, AUCTION, { repair: 'void_live_holds' });
    const requestId = buildRequestId({
      auctionId: AUCTION,
      op: 'void',
      holdId: 'h2',
      amountCents: 0,
      generation: 0,
    });
    expect(rig.audits.map((a) => a.kind)).toEqual(['paypal_call', 'state_change']);
    expect(rig.audits[0]).toMatchObject({
      kind: 'paypal_call',
      auctionId: AUCTION,
      holdId: 'h2',
      op: 'void',
      requestId,
      outcome: 'definite',
      status: 200,
      label: 'ok',
    });
    // The void went to PayPal with the same request id the row names.
    expect(callsOn(rig, rig.auth.b2, 'void')).toBe(1);
  });
});

describe('reconcileAll and the timer (R-PAY-102)', () => {
  it('reconciles every listed auction and isolates a failing one', async () => {
    const rig = await makeRig();
    const deps = { ...rig.deps, listAuctions: async () => ['missing', AUCTION] };
    const out = await reconcileAll(deps);
    expect(out.reports.map((r) => r.auctionId)).toEqual(['missing', AUCTION]);
    expect(out.errors).toEqual([]);
  });

  it('runs on the interval while active, never overlaps, and stops', async () => {
    const rig = await makeRig();
    let tick: () => void = () => undefined;
    let cleared = false;
    let active = true;
    const seen: number[] = [];
    const timer = startReconcileTimer(
      { ...rig.deps, listAuctions: async () => [AUCTION] },
      {
        isActive: async () => active,
        onReport: (r) => void seen.push(r.reports.length),
        setInterval: (fn, ms) => {
          expect(ms).toBe(60_000);
          tick = fn;
          return 'h';
        },
        clearInterval: () => {
          cleared = true;
        },
      },
    );
    expect(await timer.runNow()).toBe(true);
    expect(seen).toEqual([1]);
    active = false;
    expect(await timer.runNow()).toBe(false);
    tick();
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual([1]);
    timer.stop();
    expect(cleared).toBe(true);
  });
});
