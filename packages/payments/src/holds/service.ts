import { randomUUID } from 'node:crypto';
import { validateCeiling } from '../ceiling.js';
import { PaymentsConfigError } from '../config.js';
import type { HoldErrorCode } from '../contract/web.js';
import { PayPalError } from '../errors.js';
import type { AuditSink, Clock, HoldStore, PaymentsGateway } from '../ports.js';
import { buildRequestId } from '../requestId.js';
import type { HoldRecord } from '../types.js';

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
  private readonly inflight = new Map<string, Promise<ApprovedHold>>();

  constructor(private readonly deps: HoldServiceDeps) {
    this.newId = deps.newId ?? (() => randomUUID());
    this.pendingTtlMs = deps.pendingTtlMs ?? DEFAULT_PENDING_TTL_MS;
  }

  /** The bidder's hold that counts: HELD or CAPTURED first, then a pending one. */
  private async current(auctionId: string, bidderId: string): Promise<HoldRecord | null> {
    const all = (await this.deps.holds.listByAuction(auctionId)).filter(
      (h) => h.bidderId === bidderId && !TERMINAL.has(h.status),
    );
    const settled = all.find((h) => h.status !== 'PENDING_APPROVAL');
    return settled ?? all[all.length - 1] ?? null;
  }

  async createHoldOrder(i: CreateHoldInput): Promise<CreatedHold> {
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
          return { holdId: existing.holdId, orderId: existing.orderId };
        }
        // A lapsed order, or one for another amount, is abandoned; no PayPal call is needed.
        await this.deps.holds.put({ ...existing, status: 'EXPIRED' });
        await this.audit(existing, 'PENDING_APPROVAL', 'EXPIRED', 'hold_abandoned');
      }

      const holdId = this.newId();
      const requestId = buildRequestId({
        auctionId: i.auctionId,
        op: 'order',
        holdId,
        amountCents: i.ceilingCents,
        generation: 0,
      });
      const order = await this.deps.gateway.createOrder({
        holdId,
        ceilingCents: i.ceilingCents,
        description: `Gavel hold for auction ${i.auctionId}`,
        requestId,
      });
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
      return { holdId, orderId: order.orderId };
    } catch (e) {
      throw toHoldError(e);
    }
  }

  /**
   * Authorizes the approved order and stores the authorization id (R-PAY-033).
   * Repeated and concurrent calls for one hold share one authorize request.
   */
  completeApproval(i: CompleteApprovalInput): Promise<ApprovedHold> {
    const running = this.inflight.get(i.holdId);
    if (running !== undefined) return running;
    const p = this.complete(i.holdId, i.orderId).finally(() => {
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
      if (hold.status !== 'PENDING_APPROVAL') {
        throw new HoldError('order_not_found', 'no pending hold for this order');
      }
      const authorization = await this.authorize(hold);
      const held: HoldRecord = {
        ...hold,
        authId: authorization.authId,
        // The hold never exceeds what PayPal authorized.
        ceilingCents: Math.min(hold.ceilingCents, authorization.amountCents),
        status: 'HELD',
      };
      await this.deps.holds.put(held);
      await this.audit(held, 'PENDING_APPROVAL', 'HELD', 'hold_authorized');
      return approved(held);
    } catch (e) {
      throw toHoldError(e);
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
      return await gateway.authorizeOrder(hold.orderId, requestId);
    } catch (e) {
      const lost = e instanceof PayPalError && (e.outcome === 'unknown' || isAlreadyAuthorized(e));
      if (!lost) throw e;
      // The answer may have been lost: the order says whether the authorization exists.
      const order = await gateway.getOrder(hold.orderId);
      if (order.authId === undefined) throw e;
      return { authId: order.authId, amountCents: hold.ceilingCents };
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

function isAlreadyAuthorized(e: PayPalError): boolean {
  return e.issue === 'ORDER_ALREADY_AUTHORIZED';
}

function approved(h: HoldRecord): ApprovedHold {
  return { holdId: h.holdId, status: 'HELD', ceilingCents: h.ceilingCents };
}
