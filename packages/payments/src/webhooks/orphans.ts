import type { HoldStore, WebhookEventStore } from '../ports.js';
import type { HoldRecord, StoredWebhook } from '../types.js';
import { parseEvent } from './dedupe.js';
import { observeHold, toHint, type HoldHint, type ObserveDeps } from './merge.js';

/**
 * Out-of-order and early events (SPEC 3.7, R-PAY-096, R-PAY-126).
 *
 * An event for a hold that is not known yet is parked for 10 minutes and tried
 * again by `sweepOrphans`. A capture event that finds the hold still `HELD`
 * marks the event `observed_captured`: the hold record now says CAPTURED, and the
 * saga adopts that capture at its next truth check (it reads PayPal before it
 * captures). Every event is answered by a truth check, so the final hold status
 * does not depend on the order or the number of deliveries.
 */

export const ORPHAN_WINDOW_MS = 600_000;

export type EventResult =
  | 'ignored_unknown_type'
  | 'parked'
  | 'orphan_expired'
  | 'observed_captured'
  | 'applied'
  | 'unchanged'
  | 'stale'
  | 'status_conflict';

export type ProcessOutcome = EventResult | 'retry';

export interface ProcessorDeps extends ObserveDeps {
  events: Pick<WebhookEventStore, 'markProcessed' | 'parkOrphan'>;
  /** Resolves the hold a hint is about, or null when it is not known (yet). */
  findHold(hint: HoldHint): Promise<HoldRecord | null>;
}

/**
 * Hold lookup for hints: by hold id when the event carries one, otherwise by a
 * scan of the open auctions for a matching authorization, order or capture id.
 */
export function createHoldFinder(
  holds: Pick<HoldStore, 'get' | 'listByAuction'>,
  auctionIds: () => Promise<readonly string[]>,
): (hint: HoldHint) => Promise<HoldRecord | null> {
  return async (hint) => {
    if (hint.holdId !== undefined) return holds.get(hint.holdId);
    if (hint.authId === undefined && hint.orderId === undefined) return null;
    for (const auctionId of await auctionIds()) {
      for (const r of await holds.listByAuction(auctionId)) {
        if (hint.authId !== undefined && r.authId === hint.authId) return r;
        if (hint.orderId !== undefined && r.orderId === hint.orderId) return r;
      }
    }
    return null;
  };
}

/**
 * Processes one stored event: map to a hint, find the hold, check the truth, merge.
 * Records the result on the event; `retry` leaves it unprocessed so a sweep tries again.
 */
export async function processEvent(
  deps: ProcessorDeps,
  ev: StoredWebhook,
): Promise<ProcessOutcome> {
  const parsed = parseEvent(ev.body);
  const hint = toHint(parsed.eventType, parsed.resource);
  if (hint === null) {
    await deps.events.markProcessed(ev.id, 'ignored_unknown_type');
    return 'ignored_unknown_type';
  }
  const record = await deps.findHold(hint);
  if (record === null) {
    if (ev.parkedUntilMs === undefined) {
      await deps.events.parkOrphan(ev.id, ev.receivedAtMs + ORPHAN_WINDOW_MS);
    }
    return 'parked';
  }
  const r = await observeHold(deps, record, hint);
  if (r.outcome === 'unobservable') return 'retry';
  let result: EventResult;
  if (r.outcome === 'conflict') result = 'status_conflict';
  else if (r.outcome === 'applied' && r.status === 'CAPTURED' && r.previous !== 'CAPTURED') {
    result = 'observed_captured';
  } else result = r.outcome;
  await deps.events.markProcessed(ev.id, result);
  return result;
}

export interface SweepResult {
  processed: number;
  parked: number;
  expired: number;
  retry: number;
}

/**
 * Tries every event that has no result yet, oldest first: events that were stored
 * but never processed (a crash between store and process) and parked orphans.
 * An orphan still unknown after its window is closed as `orphan_expired`; the
 * reconciler covers anything it left behind (R-PAY-100).
 */
export async function sweepOrphans(
  deps: ProcessorDeps & { events: Pick<WebhookEventStore, 'listUnprocessed'> },
  nowMs: number,
): Promise<SweepResult> {
  const out: SweepResult = { processed: 0, parked: 0, expired: 0, retry: 0 };
  for (const ev of await deps.events.listUnprocessed()) {
    const r = await processEvent(deps, ev);
    if (r === 'parked') {
      if (ev.parkedUntilMs !== undefined && ev.parkedUntilMs <= nowMs) {
        await deps.events.markProcessed(ev.id, 'orphan_expired');
        out.expired += 1;
      } else out.parked += 1;
    } else if (r === 'retry') out.retry += 1;
    else out.processed += 1;
  }
  return out;
}
