import { PayPalError } from '../errors.js';
import type { AuditSink, Clock, HoldStore, PaymentsGateway } from '../ports.js';
import { buildRequestId } from '../requestId.js';
import type { HoldRecord } from '../types.js';
import { sharedHoldQueue } from '../webhooks/merge.js';
import { auditedCall } from './audited.js';
import {
  DEFAULT_PENDING_TTL_MS,
  HoldError,
  toHoldError,
  type ApprovedHold,
  type HoldService,
} from './service.js';

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
 * R8-P05: the authorize call is not journaled first, so a crash right after PayPal
 * created the authorization leaves a pending record with no authorization id. When
 * a pending hold is abandoned, or swept by `sweepStalePending`, the order is read
 * first; a live authorization found on it is voided (auction closed) or adopted
 * (auction open) instead of being left to lapse at PayPal.
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
  gateway: Pick<PaymentsGateway, 'getOrder'> & Partial<Pick<PaymentsGateway, 'voidAuthorization'>>;
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

/** Authorization statuses that still hold money at PayPal. */
const LIVE_AUTH: ReadonlySet<string> = new Set(['CREATED', 'PENDING']);

/**
 * Voids a live authorization found on a hold's order under the hold's fixed void request
 * id, with its `paypal_call` audit row (RT4-saga-04). A gateway without voids does nothing.
 */
async function voidAudited(deps: RecoverDeps, hold: HoldRecord, authId: string): Promise<void> {
  const { gateway } = deps;
  if (gateway.voidAuthorization === undefined) return;
  const requestId = buildRequestId({
    auctionId: hold.auctionId,
    op: 'void',
    holdId: hold.holdId,
    amountCents: 0,
    generation: 0,
  });
  const ref = { auctionId: hold.auctionId, holdId: hold.holdId, op: 'void' as const, requestId };
  await auditedCall(deps, ref, async () => {
    await gateway.voidAuthorization?.(authId, requestId);
  });
}

async function abandon(deps: RecoverDeps, hold: HoldRecord): Promise<RecoverResult> {
  let authId: string | undefined;
  if (deps.gateway.voidAuthorization !== undefined) {
    try {
      const order = await deps.gateway.getOrder(hold.orderId);
      if (order.authId !== undefined && LIVE_AUTH.has(order.authStatus ?? 'CREATED')) {
        await voidAudited(deps, hold, order.authId);
      }
      authId = order.authId;
    } catch (e) {
      // Not read or not voided: the record stays pending so a later sweep tries again.
      if (e instanceof PayPalError) return { status: 'unavailable' };
      throw e;
    }
  }
  await deps.holds.put({ ...hold, ...(authId === undefined ? {} : { authId }), status: 'EXPIRED' });
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

/**
 * Finds pending holds older than `minAgeMs` whose order already carries an
 * authorization (the crash window of R8-P05) and recovers them: adopted while the
 * auction is open, voided and expired once it is closed. Pending holds without an
 * authorization are left to the normal approval flow.
 */
export async function sweepStalePending(
  deps: RecoverDeps,
  auctionId: string,
  minAgeMs: number,
  expiredLookbackMs: number = DEFAULT_EXPIRED_LOOKBACK_MS,
  opts: SweepPendingOptions = {},
): Promise<Array<{ holdId: string; result: RecoverResult }>> {
  const now = deps.clock.nowMs();
  const ttlMs = opts.pendingTtlMs ?? DEFAULT_PENDING_TTL_MS;
  const reads = opts.reads;
  const all = await deps.holds.listByAuction(auctionId);
  const old = all
    .filter((h) => h.status === 'PENDING_APPROVAL' && now - h.createdAtMs >= minAgeMs)
    .sort((a, b) => (a.holdId < b.holdId ? -1 : 1));
  const out: Array<{ holdId: string; result: RecoverResult }> = [];
  // An abandoned record without an authorization id may still own a live authorization
  // (crash between authorize and the HELD write, then a retry that expired the record).
  const lapsed = all
    .filter(
      (h) =>
        h.status === 'EXPIRED' &&
        h.authId === undefined &&
        now - h.createdAtMs <= expiredLookbackMs,
    )
    .sort((a, b) => (a.holdId < b.holdId ? -1 : 1));
  for (const h of lapsed) {
    if (reads !== undefined && !reads.due(h.holdId, now)) continue;
    const result = await voidLapsed(deps, h);
    reads?.read(h.holdId, now, now - h.createdAtMs);
    out.push({ holdId: h.holdId, result });
  }
  for (const h of old) {
    if (reads !== undefined && !reads.due(h.holdId, now)) continue;
    const age = now - h.createdAtMs;
    let order: { authId?: string };
    try {
      order = await deps.gateway.getOrder(h.orderId);
    } catch (e) {
      if (e instanceof PayPalError) {
        reads?.read(h.holdId, now, age);
        out.push({ holdId: h.holdId, result: { status: 'unavailable' } });
        continue;
      }
      throw e;
    }
    if (order.authId === undefined) {
      // Past the lifetime of an unapproved order the record lapses, as HoldService treats it,
      // and leaves the sweep. Younger ones are read again later, further apart each time.
      if (age >= ttlMs && (await expirePending(deps, h))) {
        reads?.forget(h.holdId);
        out.push({ holdId: h.holdId, result: { status: 'abandoned' } });
      } else reads?.read(h.holdId, now, age);
      continue;
    }
    reads?.forget(h.holdId);
    out.push({
      holdId: h.holdId,
      result: await recoverOrder(deps, { auctionId, orderId: h.orderId }),
    });
  }
  return out;
}

export interface SweepPendingOptions {
  /** Age after which a pending hold without an authorization is expired. Default 3 h. */
  pendingTtlMs?: number;
  /** Back-off between reads of the same hold; without it every sweep reads every hold. */
  reads?: PendingReadBackoff;
}

/**
 * Spacing of the sweep's PayPal reads per hold: each read that finds nothing to do (or fails)
 * doubles the wait, from `baseMs` up to `capMs`. A hold older than `lapseAfterMs` waits up to
 * `lateCapMs`. Kept in memory; a restart starts every hold again from the first wait.
 */
export class PendingReadBackoff {
  private readonly next = new Map<string, { tries: number; atMs: number }>();

  constructor(
    private readonly baseMs: number = 60_000,
    private readonly capMs: number = 30 * 60_000,
    private readonly lateCapMs: number = 6 * 60 * 60_000,
    private readonly lapseAfterMs: number = DEFAULT_PENDING_TTL_MS,
  ) {}

  due(holdId: string, nowMs: number): boolean {
    const n = this.next.get(holdId);
    return n === undefined || nowMs >= n.atMs;
  }

  /** Records a read that did not settle the hold. */
  read(holdId: string, nowMs: number, ageMs: number): void {
    const tries = (this.next.get(holdId)?.tries ?? 0) + 1;
    const cap = ageMs >= this.lapseAfterMs ? this.lateCapMs : this.capMs;
    this.next.set(holdId, {
      tries,
      atMs: nowMs + Math.min(cap, this.baseMs * 2 ** Math.min(tries, 30)),
    });
  }

  forget(holdId: string): void {
    this.next.delete(holdId);
  }

  get size(): number {
    return this.next.size;
  }
}

/**
 * Expires a pending record whose order PayPal shows without an authorization, inside the
 * hold's queue and from the record as it is now. False when an approval or webhook moved it on.
 */
async function expirePending(deps: RecoverDeps, hold: HoldRecord): Promise<boolean> {
  return sharedHoldQueue.run(hold.holdId, async () => {
    const latest = (await deps.holds.get(hold.holdId)) ?? hold;
    if (latest.status !== 'PENDING_APPROVAL' || latest.authId !== undefined) return false;
    await deps.holds.put({ ...latest, status: 'EXPIRED' });
    await deps.audit.append({
      kind: 'state_change',
      auctionId: latest.auctionId,
      holdId: latest.holdId,
      from: 'PENDING_APPROVAL',
      to: 'EXPIRED',
      label: 'hold_abandoned',
      tsMs: deps.clock.nowMs(),
    });
    return true;
  });
}

/** How far back the sweep looks at abandoned records that carry no authorization id. */
export const DEFAULT_EXPIRED_LOOKBACK_MS = 3 * 60 * 60 * 1000;

/** Voids a live authorization found on an expired record's order and keeps its id on the record. */
async function voidLapsed(deps: RecoverDeps, hold: HoldRecord): Promise<RecoverResult> {
  if (deps.gateway.voidAuthorization === undefined) return { status: 'unavailable' };
  try {
    return await sharedHoldQueue.run(hold.holdId, async () => {
      const latest = (await deps.holds.get(hold.holdId)) ?? hold;
      if (latest.status !== 'EXPIRED' || latest.authId !== undefined) {
        return { status: 'unknown_order' } as const;
      }
      const order = await deps.gateway.getOrder(latest.orderId);
      if (order.authId === undefined) return { status: 'unknown_order' } as const;
      if (LIVE_AUTH.has(order.authStatus ?? 'CREATED')) {
        await voidAudited(deps, latest, order.authId);
      }
      await deps.holds.put({ ...latest, authId: order.authId });
      return { status: 'abandoned' } as const;
    });
  } catch (e) {
    if (e instanceof PayPalError) return { status: 'unavailable' };
    throw e;
  }
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
 * holds stay capturable. A hold flagged earlier is not audited again. Each write goes
 * through the shared hold queue on a fresh read, so a webhook update to the same record
 * is never overwritten with the older copy the list returned.
 */
export async function flagStaleHolds(deps: StaleDeps, auctionId: string): Promise<string[]> {
  const now = deps.clock.nowMs();
  const flagged: string[] = [];
  const all = await deps.holds.listByAuction(auctionId);
  for (const h of all.sort((a, b) => (a.holdId < b.holdId ? -1 : 1))) {
    if (h.status !== 'HELD' || !isStale(h.createdAtMs, now, deps.holdMaxAgeMs)) continue;
    if (h.stale === true) continue;
    const marked = await sharedHoldQueue.run(h.holdId, async () => {
      const current = await deps.holds.get(h.holdId);
      if (current === null || current.status !== 'HELD' || current.stale === true) return false;
      await deps.holds.put({ ...current, stale: true });
      return true;
    });
    if (!marked) continue;
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
