import { FakeClock, FakePayPalCore, type FakeWebhookEvent } from '../../src/fake/core.js';
import { FakeGateway } from '../../src/fake/gateway.js';
import { planDeliveries, type DeliveryOptions } from '../../src/fake/webhooks.js';
import type { PaymentsGateway } from '../../src/ports.js';
import { MemoryHoldStore, MemoryWebhookEventStore } from '../../src/stores/memory.js';
import type { HoldRecord, PaymentAudit, StoredWebhook } from '../../src/types.js';
import { createHoldFinder, type ProcessorDeps } from '../../src/webhooks/orphans.js';

export const START_MS = 1_800_000_000_000;
export const AUCTION = 'auc1';

export interface WebhookRig {
  clock: FakeClock;
  core: FakePayPalCore;
  gateway: PaymentsGateway;
  holds: MemoryHoldStore;
  events: MemoryWebhookEventStore;
  audits: PaymentAudit[];
  deps: ProcessorDeps;
  /** holdId -> authId */
  auth: Record<string, string>;
}

function patched(base: PaymentsGateway, patch: Partial<PaymentsGateway>): PaymentsGateway {
  return {
    createOrder: (i) => base.createOrder(i),
    getOrder: (id) => base.getOrder(id),
    authorizeOrder: (id, r) => base.authorizeOrder(id, r),
    getHoldTruth: (h) => base.getHoldTruth(h),
    capture: (a, i) => base.capture(a, i),
    voidAuthorization: (a, r) => base.voidAuthorization(a, r),
    reauthorize: (a, i) => base.reauthorize(a, i),
    ...patch,
  };
}

/** Holds registered with status HELD unless `register` is false (events for unknown holds). */
export async function makeWebhookRig(
  holdCeilings: Record<string, number>,
  opts: { register?: boolean; gateway?: Partial<PaymentsGateway> } = {},
): Promise<WebhookRig> {
  const clock = new FakeClock(START_MS);
  const core = new FakePayPalCore({ clock });
  const base = new FakeGateway(core);
  const gateway = opts.gateway === undefined ? base : patched(base, opts.gateway);
  const holds = new MemoryHoldStore();
  const events = new MemoryWebhookEventStore();
  const audits: PaymentAudit[] = [];
  const auth: Record<string, string> = {};
  for (const [holdId, cents] of Object.entries(holdCeilings)) {
    auth[holdId] = core.createAuthorization(`payer-${holdId}`, cents).id;
  }
  const rig: WebhookRig = {
    clock,
    core,
    gateway,
    holds,
    events,
    audits,
    auth,
    deps: {
      gateway,
      holds,
      events,
      audit: { append: async (e) => void audits.push(e) },
      clock: { nowMs: () => clock.nowMs() },
      findHold: createHoldFinder(holds, async () => [AUCTION]),
    },
  };
  if (opts.register !== false) {
    for (const [holdId, cents] of Object.entries(holdCeilings))
      await registerHold(rig, holdId, cents);
  }
  return rig;
}

export function holdRecord(rig: WebhookRig, holdId: string, ceilingCents: number): HoldRecord {
  return {
    holdId,
    auctionId: AUCTION,
    bidderId: `bidder-${holdId}`,
    orderId: `ORDER-${holdId}`,
    authId: authOf(rig, holdId),
    ceilingCents,
    status: 'HELD',
    createdAtMs: START_MS,
  };
}

export async function registerHold(rig: WebhookRig, holdId: string, cents: number): Promise<void> {
  await rig.holds.put(holdRecord(rig, holdId, cents));
}

export function storedFrom(e: FakeWebhookEvent, receivedAtMs = START_MS): StoredWebhook {
  return {
    id: e.id,
    eventType: e.eventType,
    receivedAtMs,
    body: JSON.stringify({ id: e.id, event_type: e.eventType, resource: e.resource }),
  };
}

/** The events a receiver would see for these options, as stored rows (duplicates included). */
export function deliveries(
  events: readonly FakeWebhookEvent[],
  opts: DeliveryOptions,
): StoredWebhook[] {
  return planDeliveries(events, opts).map((d) => storedFrom(d.event));
}

export async function mustGet(rig: WebhookRig, holdId: string): Promise<HoldRecord> {
  const r = await rig.holds.get(holdId);
  if (r === null) throw new Error(`hold ${holdId} is not registered`);
  return r;
}

export function authOf(rig: WebhookRig, holdId: string): string {
  const a = rig.auth[holdId];
  if (a === undefined) throw new Error(`no authorization for ${holdId}`);
  return a;
}
