import { PayPalError } from '../errors.js';
import type { AuditSink, Clock, HoldStore, PaymentsGateway } from '../ports.js';
import type { HoldRecord } from '../types.js';
import { HoldError, toHoldError, type ApprovedHold, type HoldService } from './service.js';

/**
 * Hold recovery and the stale flag (SPEC 8.1, R-PAY-034).
 *
 * `recoverOrder`: the buyer approved the order at PayPal and closed the tab before
 * the approval reached the server, so the order is APPROVED but the hold has no
 * authorization. No money has moved yet. A sweep, and the next createHoldOrder,
 * call this for such an order:
 *   - the auction is open: the order is authorized through HoldService, which
 *     keeps its own idempotency (one authorize per hold);
 *   - the auction is closed: the hold is abandoned (EXPIRED); nothing is sent to
 *     PayPal and the order is left to lapse.
 * An order the buyer has not approved is left as it is.
 *
 * `flagStaleHolds`: a hold older than GAVEL_HOLD_MAX_AGE_MS at settlement start is
 * marked `stale` and audited. A stale hold is still captured (R-PAY-072); the flag
 * is information for the operator.
 */

export type RecoverResult =
  | { status: 'authorized'; hold: ApprovedHold }
  | { status: 'abandoned' }
  | { status: 'not_approved' }
  | { status: 'already_held'; holdId: string }
  | { status: 'unknown_order' }
  | { status: 'unavailable' };

export interface RecoverDeps {
  gateway: Pick<PaymentsGateway, 'getOrder'>;
  holds: HoldStore;
  audit: AuditSink;
  clock: Clock;
  service: Pick<HoldService, 'completeApproval'>;
  /** True while the auction still accepts bids; the caller owns that knowledge. */
  isAuctionOpen: (auctionId: string) => Promise<boolean>;
}

export interface RecoverInput {
  auctionId: string;
  orderId: string;
}

/** Recovers one order of an auction (see the file comment). Never throws for a PayPal outage. */
export async function recoverOrder(deps: RecoverDeps, i: RecoverInput): Promise<RecoverResult> {
  const hold = (await deps.holds.listByAuction(i.auctionId)).find((h) => h.orderId === i.orderId);
  if (hold === undefined) return { status: 'unknown_order' };
  if (hold.status !== 'PENDING_APPROVAL') {
    return hold.authId !== undefined && hold.status === 'HELD'
      ? { status: 'already_held', holdId: hold.holdId }
      : { status: 'unknown_order' };
  }

  if (!(await deps.isAuctionOpen(i.auctionId))) return abandon(deps, hold);

  let order: { status: string; authId?: string };
  try {
    order = await deps.gateway.getOrder(hold.orderId);
  } catch (e) {
    if (e instanceof PayPalError) return { status: 'unavailable' };
    throw e;
  }
  if (order.status !== 'APPROVED' && order.authId === undefined) return { status: 'not_approved' };

  try {
    const approved = await deps.service.completeApproval({
      holdId: hold.holdId,
      orderId: hold.orderId,
    });
    return { status: 'authorized', hold: approved };
  } catch (e) {
    const err = e instanceof HoldError ? e : toHoldError(e);
    if (err.code === 'paypal_unavailable' || err.code === 'kill_switch_engaged') {
      return { status: 'unavailable' };
    }
    if (err.code === 'order_not_approved') return { status: 'not_approved' };
    throw err;
  }
}

async function abandon(deps: RecoverDeps, hold: HoldRecord): Promise<RecoverResult> {
  await deps.holds.put({ ...hold, status: 'EXPIRED' });
  await deps.audit.append({
    kind: 'state_change',
    auctionId: hold.auctionId,
    holdId: hold.holdId,
    from: 'PENDING_APPROVAL',
    to: 'EXPIRED',
    label: 'hold_abandoned',
    tsMs: deps.clock.nowMs(),
  });
  return { status: 'abandoned' };
}

/** Recovers every pending order of an auction; results are in hold id order. */
export async function sweepAuction(
  deps: RecoverDeps,
  auctionId: string,
): Promise<Array<{ holdId: string; result: RecoverResult }>> {
  const pending = (await deps.holds.listByAuction(auctionId))
    .filter((h) => h.status === 'PENDING_APPROVAL')
    .sort((a, b) => (a.holdId < b.holdId ? -1 : 1));
  const out: Array<{ holdId: string; result: RecoverResult }> = [];
  for (const h of pending) {
    out.push({
      holdId: h.holdId,
      result: await recoverOrder(deps, { auctionId, orderId: h.orderId }),
    });
  }
  return out;
}

/** True when a hold created at createdAtMs is older than maxAgeMs at nowMs. */
export function isStale(createdAtMs: number, nowMs: number, maxAgeMs: number): boolean {
  return nowMs - createdAtMs > maxAgeMs;
}

export interface StaleDeps {
  holds: HoldStore;
  audit: AuditSink;
  clock: Clock;
  /** GAVEL_HOLD_MAX_AGE_MS. */
  holdMaxAgeMs: number;
}

/**
 * At settlement start: flags every live hold of the auction that is older than the
 * maximum age, audits each once (`stale_hold`) and returns their hold ids. The
 * holds stay capturable. A hold flagged earlier is not audited again.
 */
export async function flagStaleHolds(deps: StaleDeps, auctionId: string): Promise<string[]> {
  const now = deps.clock.nowMs();
  const flagged: string[] = [];
  const all = await deps.holds.listByAuction(auctionId);
  for (const h of all.sort((a, b) => (a.holdId < b.holdId ? -1 : 1))) {
    if (h.status !== 'HELD' || !isStale(h.createdAtMs, now, deps.holdMaxAgeMs)) continue;
    if (h.stale === true) continue;
    await deps.holds.put({ ...h, stale: true });
    await deps.audit.append({
      kind: 'stale_hold',
      auctionId,
      holdId: h.holdId,
      label: `age_ms=${now - h.createdAtMs}`,
      tsMs: now,
    });
    flagged.push(h.holdId);
  }
  return flagged;
}
