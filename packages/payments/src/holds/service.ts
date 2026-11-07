import { randomUUID } from 'node:crypto';
import { validateCeiling } from '../ceiling.js';
import { PaymentsConfigError } from '../config.js';
import type { HoldErrorCode } from '../contract/web.js';
import { PayPalError } from '../errors.js';
import type { AuditSink, Clock, HoldStore, PaymentsGateway } from '../ports.js';
import { buildRequestId } from '../requestId.js';
import type { HoldRecord } from '../types.js';
import { sharedHoldQueue, type KeyedQueue } from '../webhooks/merge.js';
import { auditedCall } from './audited.js';

/**
 * HoldService: the server side of the hold flow (SPEC 3.3, R-PAY-030 to R-PAY-033).
 *
 * 1. `createHoldOrder` validates the ceiling against the cap and the auction's
 *    presets, creates the AUTHORIZE order for exactly that amount and stores a
 *    PENDING_APPROVAL hold. The amount sent to PayPal is the validated ceiling;
 *    the browser contributes nothing but the choice among presets.
 * 2. The buyer approves in the browser.
 * 3. `completeApproval` authorizes the order, stores the authorization id PayPal
 *    returns and moves the hold to HELD. The browser never supplies an
 *    authorization id or an amount; fields beyond holdId and orderId are ignored.
 *
 * Both calls are idempotent. The request ids are fixed per hold, so a repeated or
 * resumed call replays the same PayPal request, and local state answers repeats
 * without a second authorize. When an authorize answer is lost, the order is read
 * back and an existing authorization is adopted.
 *
 * Failures are HoldError with a code of the web contract (HOLD_ERROR_CODES).
 */

export class HoldError extends Error {
  code: HoldErrorCode;
  constructor(code: HoldErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'HoldError';
    this.code = code;
  }
}

export interface HoldServiceDeps {
  gateway: PaymentsGateway;
  holds: HoldStore;
  audit: AuditSink;
  clock: Clock;
  /** GAVEL_MAX_CEILING_CENTS. */
  maxCeilingCents: number;
  /** New hold ids. Default: random UUIDs. */
  newId?: () => string;
  /** How long a PENDING_APPROVAL order stays reusable. Default 3 hours (PayPal orders lapse). */
  pendingTtlMs?: number;
  /**
   * Serialises every write to one hold with the webhook merge (R8-P04). Share the
   * queue the webhook processor uses; the default is the process-wide one.
   */
  queue?: KeyedQueue;
}

export interface CreateHoldInput {
  auctionId: string;
  bidderId: string;
  ceilingCents: number;
  /** The auction's allowed ceilings, from the caller. */
  presetsCents: readonly number[];
}

export interface CreatedHold {
  holdId: string;
  orderId: string;
  /**
   * PayPal's own approval page for the order, when PayPal named one. The browser falls back to
   * it when the approval popup cannot open (issue 1778).
   */
  approveUrl?: string;
}

export interface CompleteApprovalInput {
  holdId: string;
  orderId: string;
}

export interface ApprovedHold {
  holdId: string;
  status: 'HELD';
  ceilingCents: number;
}

export const DEFAULT_PENDING_TTL_MS = 3 * 60 * 60 * 1000;

const TERMINAL: ReadonlySet<HoldRecord['status']> = new Set(['VOIDED', 'EXPIRED', 'DENIED']);

/** Maps anything a payment call can throw to a contract error code. */
export function toHoldError(e: unknown): HoldError {
  if (e instanceof HoldError) return e;
  if (e instanceof PaymentsConfigError) {
    return new HoldError('payments_not_sandbox', 'payments are not configured for the sandbox', e);
  }
  if (e instanceof PayPalError) {
    if (e.kind === 'kill_switch_engaged') {
      return new HoldError('kill_switch_engaged', 'payments are paused', e);
    }
    if (e.kind === 'ceiling_out_of_range') {
      return new HoldError('ceiling_out_of_range', e.message, e);
    }
    if (e.name === 'order_not_approved' || e.issue === 'ORDER_NOT_APPROVED') {
      return new HoldError('order_not_approved', 'the order is not approved yet', e);
    }
    if (e.kind === 'not_found') return new HoldError('order_not_found', 'order not found', e);
    return new HoldError('paypal_unavailable', 'PayPal could not be reached', e);
  }
  throw e;
}

export class HoldService {
  private readonly newId: () => string;
  private readonly pendingTtlMs: number;
  private readonly queue: KeyedQueue;
  private readonly inflight = new Map<string, Promise<ApprovedHold>>();
  /** Tail of the createHoldOrder queue per (auction, bidder). */
  private readonly creating = new Map<string, Promise<unknown>>();
  /** Approval link per pending hold, so a repeated create hands back the same one. */
  private readonly approveUrls = new Map<string, string>();

  constructor(private readonly deps: HoldServiceDeps) {
    this.newId = deps.newId ?? (() => randomUUID());
    this.pendingTtlMs = deps.pendingTtlMs ?? DEFAULT_PENDING_TTL_MS;
    this.queue = deps.queue ?? sharedHoldQueue;
  }

  /** The bidder's hold that counts: HELD or CAPTURED first, then a pending one. */
  private async current(auctionId: string, bidderId: string): Promise<HoldRecord | null> {
    const all = (await this.deps.holds.listByAuction(auctionId)).filter(
      (h) => h.bidderId === bidderId && !TERMINAL.has(h.status),
    );
    const settled = all.find((h) => h.status !== 'PENDING_APPROVAL');
    return settled ?? all[all.length - 1] ?? null;
  }

  /**
   * Creates the bidder's hold order. Calls for one (auction, bidder) run one after
   * the other, so a double click or a second tab sees the first call's record and
   * gets the same order back instead of creating a second authorization.
   */
  createHoldOrder(i: CreateHoldInput): Promise<CreatedHold> {
    const key = JSON.stringify([i.auctionId, i.bidderId]);
    const prev = this.creating.get(key) ?? Promise.resolve();
    const run = prev.then(
      () => this.createOne(i),
      () => this.createOne(i),
    );
    this.creating.set(key, run);
    const clear = (): void => {
      if (this.creating.get(key) === run) this.creating.delete(key);
    };
    void run.then(clear, clear);
    return run;
  }

  private async createOne(i: CreateHoldInput): Promise<CreatedHold> {
    try {
      validateCeiling(i.ceilingCents, {
        maxCeilingCents: this.deps.maxCeilingCents,
        presetsCents: i.presetsCents,
      });
      const now = this.deps.clock.nowMs();
      const existing = await this.current(i.auctionId, i.bidderId);
      if (existing !== null) {
        if (existing.status !== 'PENDING_APPROVAL') {
          throw new HoldError('hold_exists', 'the bidder already has a hold in this auction');
        }
        const fresh = now - existing.createdAtMs <= this.pendingTtlMs;
        if (fresh && existing.ceilingCents === i.ceilingCents) {
          return this.created(existing.holdId, existing.orderId);
        }
        // A lapsed order, or one for another amount, is abandoned; no PayPal call is needed.
        await this.abandonPending(existing);
      }

      const holdId = this.newId();
      const requestId = buildRequestId({
        auctionId: i.auctionId,
        op: 'order',
        holdId,
        amountCents: i.ceilingCents,
        generation: 0,
      });
      const order = await auditedCall(
        this.deps,
        { auctionId: i.auctionId, holdId, op: 'order', requestId },
        () =>
          this.deps.gateway.createOrder({
            holdId,
            ceilingCents: i.ceilingCents,
            description: `Gavel hold for auction ${i.auctionId}`,
            requestId,
          }),
      );
      const record: HoldRecord = {
        holdId,
        auctionId: i.auctionId,
        bidderId: i.bidderId,
        orderId: order.orderId,
        ceilingCents: i.ceilingCents,
        status: 'PENDING_APPROVAL',
        createdAtMs: now,
      };
      await this.deps.holds.put(record);
      await this.audit(record, '', 'PENDING_APPROVAL', 'hold_created');
      if (order.approveUrl !== undefined && order.approveUrl !== '') {
        this.approveUrls.set(holdId, order.approveUrl);
      }
      return this.created(holdId, order.orderId);
    } catch (e) {
      throw toHoldError(e);
    }
  }

  private created(holdId: string, orderId: string): CreatedHold {
    const approveUrl = this.approveUrls.get(holdId);
    return approveUrl === undefined ? { holdId, orderId } : { holdId, orderId, approveUrl };
  }

  /**
   * Drops a hold the bidder walked away from (cancel, decline, mismatch). Idempotent:
   * a missing, already expired or already authorized hold is left as it is, so a late
   * or repeated call never voids a hold an approval has since settled. Resolves true
   * when the hold is expired (now or before), false when it was left in place.
   */
  async abandonHold(holdId: string): Promise<boolean> {
    const hold = await this.deps.holds.get(holdId);
    if (hold === null) return false;
    if (hold.status === 'EXPIRED') return true;
    if (hold.status !== 'PENDING_APPROVAL') return false;
    try {
      await this.abandonPending(hold);
      return true;
    } catch (e) {
      // An approval won the race: the bidder has a hold now, nothing to abandon.
      if (e instanceof HoldError && e.code === 'hold_exists') return false;
      throw e;
    }
  }

  /**
   * Authorizes the approved order and stores the authorization id (R-PAY-033).
   * Repeated and concurrent calls for one hold share one authorize request.
   */
  completeApproval(i: CompleteApprovalInput): Promise<ApprovedHold> {
    const running = this.inflight.get(i.holdId);
    if (running !== undefined) return running;
    const p = this.queue
      .run(i.holdId, () => this.complete(i.holdId, i.orderId))
      .finally(() => {
        if (this.inflight.get(i.holdId) === p) this.inflight.delete(i.holdId);
      });
    this.inflight.set(i.holdId, p);
    return p;
  }

  private async complete(holdId: string, orderId: string): Promise<ApprovedHold> {
    try {
      const hold = await this.deps.holds.get(holdId);
      if (hold === null || hold.orderId !== orderId) {
        throw new HoldError('order_not_found', 'no pending hold for this order');
      }
      if (hold.status === 'HELD' && hold.authId !== undefined) return approved(hold);
      if (!awaitsAuthorization(hold)) {
        throw new HoldError('order_not_found', 'no pending hold for this order');
      }
      const authorization = await this.authorize(hold);
      // The record may have been abandoned while the authorize call was in flight.
      const current = await this.deps.holds.get(holdId);
      if (current === null || !awaitsAuthorization(current)) {
        await this.releaseAbandoned(current ?? hold, authorization.authId);
        throw new HoldError('order_not_found', 'no pending hold for this order');
      }
      const held: HoldRecord = {
        ...hold,
        authId: authorization.authId,
        // The hold never exceeds what PayPal authorized.
        ceilingCents: Math.min(hold.ceilingCents, authorization.amountCents),
        status: 'HELD',
      };
      await this.deps.holds.put(held);
      this.approveUrls.delete(holdId);
      await this.audit(held, hold.status, 'HELD', 'hold_authorized');
      return approved(held);
    } catch (e) {
      throw toHoldError(e);
    }
  }

  /**
   * Expires a pending record inside the hold's queue, from the record as it is now.
   * A record an approval or webhook moved on meanwhile is not expired: the bidder
   * then has a hold, and creating a second one is refused.
   */
  private abandonPending(existing: HoldRecord): Promise<void> {
    return this.queue.run(existing.holdId, async () => {
      const latest = (await this.deps.holds.get(existing.holdId)) ?? existing;
      if (latest.status === 'EXPIRED') return;
      if (!awaitsAuthorization(latest) || latest.authId !== undefined) {
        throw new HoldError('hold_exists', 'the bidder already has a hold in this auction');
      }
      // R8-P05: a crash after PayPal authorized leaves no authId here. Ask PayPal before
      // expiring, so a live authorization is voided instead of sitting next to a second hold.
      // A PayPal outage stops the abandon: the record stays pending and no second order is made.
      const found = await this.liveAuthorization(latest);
      if (found !== undefined) await this.voidFound(latest, found);
      await this.deps.holds.put({
        ...latest,
        ...(found === undefined ? {} : { authId: found }),
        status: 'EXPIRED',
      });
      this.approveUrls.delete(latest.holdId);
      await this.audit(latest, 'PENDING_APPROVAL', 'EXPIRED', 'hold_abandoned');
    });
  }

  /** The id of a live authorization on the record's order, if PayPal has one. */
  private async liveAuthorization(h: HoldRecord): Promise<string | undefined> {
    const order = await this.deps.gateway.getOrder(h.orderId);
    if (order.authId === undefined) return undefined;
    return LIVE_AUTH.has(order.authStatus ?? 'CREATED') ? order.authId : undefined;
  }

  /**
   * Voids an authorization of the hold under its fixed void request id, with its
   * `paypal_call` audit row (RT4-saga-04).
   */
  private voidFound(h: HoldRecord, authId: string): Promise<void> {
    const requestId = buildRequestId({
      auctionId: h.auctionId,
      op: 'void',
      holdId: h.holdId,
      amountCents: 0,
      generation: 0,
    });
    return auditedCall(
      this.deps,
      { auctionId: h.auctionId, holdId: h.holdId, op: 'void', requestId },
      () => this.deps.gateway.voidAuthorization(authId, requestId),
    );
  }

  /** Keeps the authorization id on an abandoned record and voids it at once; a failed void stays findable. */
  private async releaseAbandoned(record: HoldRecord, authId: string): Promise<void> {
    await this.deps.holds.put({ ...record, authId, status: 'EXPIRED' });
    await this.audit(record, record.status, 'EXPIRED', 'hold_authorized_after_abandon');
    try {
      await this.voidFound(record, authId);
    } catch (e) {
      if (!(e instanceof PayPalError)) throw e;
    }
  }

  /** Authorizes, or adopts an authorization that already exists on the order. */
  private async authorize(hold: HoldRecord): Promise<{ authId: string; amountCents: number }> {
    const { gateway } = this.deps;
    const requestId = buildRequestId({
      auctionId: hold.auctionId,
      op: 'authorize',
      holdId: hold.holdId,
      amountCents: hold.ceilingCents,
      generation: 0,
    });
    try {
      return await auditedCall(
        this.deps,
        { auctionId: hold.auctionId, holdId: hold.holdId, op: 'authorize', requestId },
        () => gateway.authorizeOrder(hold.orderId, requestId),
      );
    } catch (e) {
      const lost = e instanceof PayPalError && (e.outcome === 'unknown' || isAlreadyAuthorized(e));
      if (!lost) throw e;
      // The answer may have been lost: the order says whether the authorization exists.
      const order = await gateway.getOrder(hold.orderId);
      if (order.authId === undefined) throw e;
      // Only a CREATED authorization holds money. PENDING is not held yet and DENIED never
      // will be: adopting either would register a ceiling that reserves nothing.
      if (order.authStatus !== 'CREATED') {
        if (order.authStatus === 'DENIED') {
          throw new PayPalError({
            kind: 'declined',
            status: 200,
            name: 'AUTHORIZATION_DENIED',
            message: 'the authorization was denied',
            outcome: 'definite',
          });
        }
        throw e;
      }
      // The amount comes from PayPal; without it nothing proves what is reserved.
      if (order.authAmountCents === undefined) throw e;
      return { authId: order.authId, amountCents: order.authAmountCents };
    }
  }

  private audit(h: HoldRecord, from: string, to: string, label: string): Promise<void> {
    return this.deps.audit.append({
      kind: 'state_change',
      auctionId: h.auctionId,
      holdId: h.holdId,
      from,
      to,
      label,
      tsMs: this.deps.clock.nowMs(),
    });
  }
}

/**
 * True while a record still needs its authorization id: pending, or HELD without
 * one (written by an older webhook merge, R8-P03).
 */
function awaitsAuthorization(h: HoldRecord): boolean {
  return h.status === 'PENDING_APPROVAL' || (h.status === 'HELD' && h.authId === undefined);
}

/** Authorization statuses that still hold money at PayPal. */
const LIVE_AUTH: ReadonlySet<string> = new Set(['CREATED', 'PENDING']);

function isAlreadyAuthorized(e: PayPalError): boolean {
  return e.issue === 'ORDER_ALREADY_AUTHORIZED';
}

function approved(h: HoldRecord): ApprovedHold {
  return { holdId: h.holdId, status: 'HELD', ceilingCents: h.ceilingCents };
}
