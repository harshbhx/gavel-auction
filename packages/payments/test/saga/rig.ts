import { PayPalError } from '../../src/errors.js';
import { FakeClock, FakePayPalCore, type FakeCoreOptions } from '../../src/fake/core.js';
import { FakeGateway } from '../../src/fake/gateway.js';
import type { PaymentsGateway } from '../../src/ports.js';
import { createSettlement } from '../../src/saga/create.js';
import type { SettlementDeps } from '../../src/saga/void.js';
import { MemoryJournalStore } from '../../src/stores/memory.js';
import type { PaymentAudit, SettlementPlan } from '../../src/types.js';
import { FRESH_HOLDS } from '../helpers/age.js';

export const START_MS = 1_800_000_000_000;

export interface Rig {
  clock: FakeClock;
  core: FakePayPalCore;
  gw: PaymentsGateway;
  journals: MemoryJournalStore;
  audits: PaymentAudit[];
  auth: Record<string, string>;
  deps: SettlementDeps;
}

/** Holds with these ceilings (cents), one authorization each at the fake. */
export function makeRig(
  ceilings: Record<string, number>,
  coreOpts: FakeCoreOptions = {},
  over: Partial<SettlementDeps> = {},
): Rig {
  const clock = new FakeClock(START_MS);
  const core = new FakePayPalCore({ clock, ...coreOpts });
  const gw = new FakeGateway(core);
  const journals = new MemoryJournalStore();
  const audits: PaymentAudit[] = [];
  const auth: Record<string, string> = {};
  for (const [bidder, cents] of Object.entries(ceilings)) {
    auth[bidder] = core.createAuthorization(`payer-${bidder}`, cents).id;
  }
  const deps: SettlementDeps = {
    journals,
    gateway: gw,
    audit: { append: async (e) => void audits.push(e) },
    clock: { nowMs: () => clock.nowMs() },
    ...over,
  };
  return { clock, core, gw, journals, audits, auth, deps };
}

export function planFor(
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
      orderId: `order-${bidder}`,
    };
  }
  return {
    auctionId: 'auc1',
    reserveCents,
    candidates: candidates.map(([bidderId, priceCents]) => ({ bidderId, priceCents })),
    holds,
  };
}

export const CEILINGS = { b1: 30000, b2: 25000, b3: 20000 };

export async function seed(
  rig: Rig,
  candidates: Array<[string, number]> = [
    ['b1', 22000],
    ['b2', 21000],
    ['b3', 20000],
  ],
  ceilings: Record<string, number> = CEILINGS,
): Promise<void> {
  await createSettlement(
    { journals: rig.journals, ...FRESH_HOLDS },
    planFor(rig, ceilings, candidates),
  );
}

/** The same deps with some gateway methods replaced. */
export function withGateway(rig: Rig, patch: Partial<PaymentsGateway>): SettlementDeps {
  const base = rig.gw;
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
  return { ...rig.deps, gateway };
}

/** A definite refusal the mapper has no special meaning for. */
export function refusal(): PayPalError {
  return new PayPalError({
    kind: 'rejected',
    status: 422,
    name: 'UNPROCESSABLE_ENTITY',
    message: 'refused',
    outcome: 'definite',
  });
}

/** How many calls of this op reached the fake for this authorization. */
export function callsOf(rig: Rig, authId: string, op: string): number {
  return rig.core.calls.filter((c) => c.id === authId && c.op === op).length;
}
