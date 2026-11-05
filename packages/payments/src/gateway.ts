import { classifyError } from './errorMap.js';
import { PayPalError } from './errors.js';
import { assertNotEngaged } from './killswitch.js';
import { ORDERS_PATH, OrdersClient, type CreateOrderInput, type OrderView } from './orders.js';
import type { TokenManager } from './oauth.js';
import { PaymentsApiClient } from './paymentsApi.js';
import { decimalToCents } from './money.js';
import type { Clock, KillSwitch, PaymentsGateway } from './ports.js';
import type { CaptureRef, HoldTruth } from './types.js';

/**
 * PayPalGateway: the PaymentsGateway over the real HTTP clients (SPEC 3.2,
 * R-PAY-019, R-PAY-021). Against the fake HTTP server it runs the same client
 * code that talks to the sandbox; FakeGateway is the in-process twin and the
 * conformance test holds both to the same results.
 *
 * Latency and PayPal-Debug-Id of every attempt are logged and counted by the
 * transport the token manager was built on (log line per attempt, the
 * paypal_calls_total counter and the paypal_latency_ms histogram); failures carry
 * the debug id on the thrown PayPalError.
 *
 * Money-moving methods (createOrder, authorizeOrder, capture, reauthorize) check
 * the kill switch first; voids and reads never do (R-PAY-006, R-PAY-063).
 */

export type GatewayAuth = Pick<TokenManager, 'send'>;

export interface PayPalGatewayOptions {
  auth: GatewayAuth;
  /** True only in fake mode; passed to the approve link check. */
  fake: boolean;
  clock?: Clock;
  killSwitch?: KillSwitch;
}

type TruthStatus = HoldTruth['status'];

/** PayPal authorization statuses the truth check understands. UNVERIFIED (G1): exact names. */
const AUTH_STATUS: Readonly<Record<string, TruthStatus>> = {
  CREATED: 'CREATED',
  PENDING: 'PENDING',
  PARTIALLY_CAPTURED: 'PARTIALLY_CAPTURED',
  CAPTURED: 'CAPTURED',
  VOIDED: 'VOIDED',
  EXPIRED: 'EXPIRED',
  DENIED: 'DENIED',
};

/** Capture statuses that count as money taken or on its way. */
const COUNTED_CAPTURE: ReadonlySet<string> = new Set(['COMPLETED', 'PENDING']);

/** Capture statuses where PayPal refused the capture and took nothing (R11-O03). */
const DECLINED_CAPTURE: ReadonlySet<string> = new Set(['DECLINED', 'FAILED']);

/** Capture statuses where money was taken and then returned; kept so nothing re-captures. */
const REFUNDED_CAPTURE: ReadonlySet<string> = new Set(['REFUNDED', 'PARTIALLY_REFUNDED']);

/** Sum of the refunds PayPal lists on the order, or undefined when none can be read. */
function refundedCentsOf(payments: Json | undefined): number | undefined {
  const list = payments?.['refunds'];
  if (!Array.isArray(list) || list.length === 0) return undefined;
  let sum = 0;
  for (const raw of list) {
    const v = asObject(asObject(raw)?.['amount'])?.['value'];
    if (typeof v !== 'string') return undefined;
    try {
      sum += decimalToCents(v);
    } catch {
      return undefined;
    }
  }
  return sum;
}

type Json = Record<string, unknown>;

function asObject(v: unknown): Json | undefined {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : undefined;
}

/** The captures an order lists: those that took or may take money, and those PayPal refused. */
interface CaptureLists {
  captures: CaptureRef[];
  declined: CaptureRef[];
}

function centsOrUndefined(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    return decimalToCents(value);
  } catch {
    return undefined;
  }
}

/** Both capture lists of the order, or null when the order does not carry the field. */
function captureListsOf(order: unknown): CaptureLists | null {
  const units = asObject(order)?.['purchase_units'];
  const unit = Array.isArray(units) ? asObject(units[0]) : undefined;
  const payments = asObject(unit?.['payments']);
  if (unit === undefined) return null;
  const list = payments?.['captures'];
  const out: CaptureLists = { captures: [], declined: [] };
  if (list === undefined) return out;
  if (!Array.isArray(list)) return null;
  for (const raw of list) {
    const c = asObject(raw);
    const id = c?.['id'];
    const status = c?.['status'];
    if (typeof status === 'string' && DECLINED_CAPTURE.has(status)) {
      // A refused capture took nothing; it is kept apart so the saga can fall back on it.
      const cents = centsOrUndefined(asObject(c?.['amount'])?.['value']);
      if (typeof id !== 'string' || cents === undefined) continue;
      const refused: CaptureRef = {
        captureId: id,
        amountCents: cents,
        final: c?.['final_capture'] === true,
      };
      const inv = c?.['invoice_id'];
      if (typeof inv === 'string') refused.invoiceId = inv;
      out.declined.push(refused);
      continue;
    }
    const amount = asObject(c?.['amount']);
    const value = amount?.['value'];
    if (c === undefined || typeof id !== 'string' || typeof value !== 'string') return null;
    const refunded = typeof status === 'string' && REFUNDED_CAPTURE.has(status);
    if (typeof status === 'string' && !refunded && !COUNTED_CAPTURE.has(status)) continue;
    const cents = centsOrUndefined(value);
    if (cents === undefined) return null;
    const ref: CaptureRef = {
      captureId: id,
      amountCents: cents,
      final: c['final_capture'] === true,
    };
    if (typeof c['invoice_id'] === 'string') ref.invoiceId = c['invoice_id'];
    if (refunded) {
      const total = status === 'REFUNDED' ? cents : refundedCentsOf(payments);
      ref.refund = {
        status: status === 'REFUNDED' ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
        ...(total === undefined ? {} : { refundedCents: total }),
      };
    }
    // R11-O03: money on its way is not money taken; the saga waits for COMPLETED.
    if (status === 'PENDING') ref.pending = true;
    out.captures.push(ref);
  }
  return out;
}

/** Captures listed on the order, or null when the order does not carry the field. */
export function capturesOf(order: unknown): CaptureRef[] | null {
  return captureListsOf(order)?.captures ?? null;
}

function unreadable(status: string): PayPalError {
  return new PayPalError({
    kind: 'server_error',
    status: 200,
    name: 'UNKNOWN_AUTHORIZATION_STATUS',
    message: `authorization status ${status} is not known`,
    outcome: 'unknown',
  });
}

/**
 * R12-P03: the order named for a truth read could not be read. Like every other
 * unreadable answer (H14) it is an unknown outcome: the caller reads again later. It is
 * never "captures not observable", which a captured hold would turn into a review.
 */
function orderUnreadable(status: number, why: string, debugId?: string): PayPalError {
  return new PayPalError({
    kind: 'server_error',
    status,
    name: 'ORDER_UNREADABLE',
    message: `order read for the truth check failed: ${why}`,
    outcome: 'unknown',
    ...(debugId === undefined ? {} : { debugId }),
  });
}

export class PayPalGateway implements PaymentsGateway {
  private readonly auth: GatewayAuth;
  private readonly orders: OrdersClient;
  private readonly payments: PaymentsApiClient;
  private readonly clock: Clock;
  private readonly killSwitch: KillSwitch | undefined;

  constructor(opts: PayPalGatewayOptions) {
    this.auth = opts.auth;
    this.orders = new OrdersClient({ auth: opts.auth, fake: opts.fake });
    this.payments = new PaymentsApiClient({ auth: opts.auth });
    this.clock = opts.clock ?? { nowMs: () => Date.now() };
    this.killSwitch = opts.killSwitch;
  }

  private async gate(): Promise<void> {
    if (this.killSwitch !== undefined) await assertNotEngaged(this.killSwitch);
  }

  async createOrder(i: CreateOrderInput): Promise<{ orderId: string; approveUrl?: string }> {
    await this.gate();
    return this.orders.createOrder(i);
  }

  getOrder(orderId: string): Promise<OrderView> {
    return this.orders.getOrder(orderId);
  }

  async authorizeOrder(
    orderId: string,
    requestId: string,
  ): Promise<{ authId: string; amountCents: number }> {
    await this.gate();
    return this.orders.authorizeOrder(orderId, requestId);
  }

  /**
   * GET the authorization (status, amount) and, when the order id is known, GET
   * the order for its captures. A missing authorization is `NOT_FOUND`. Without
   * an order id `captures` is null (not observable) and `capturedCents` is 0. With an
   * order id the captures are always read: an order that answers 404, a body that does
   * not parse or a capture list of an unknown shape throws an unknown-outcome
   * PayPalError (R12-P03), so the caller reads again instead of judging a hold whose
   * captures it could not see.
   */
  async getHoldTruth(h: { holdId: string; authId: string; orderId?: string }): Promise<HoldTruth> {
    const observedAtMs = this.clock.nowMs();
    let auth;
    try {
      auth = await this.payments.getAuthorization(h.authId);
    } catch (e) {
      if (e instanceof PayPalError && e.kind === 'not_found') {
        return {
          holdId: h.holdId,
          authId: h.authId,
          status: 'NOT_FOUND',
          amountCents: 0,
          capturedCents: 0,
          captures: [],
          observedAtMs,
        };
      }
      throw e;
    }
    let status = AUTH_STATUS[auth.status];
    if (status === undefined) throw unreadable(auth.status);

    let lists: CaptureLists | null = null;
    if (h.orderId !== undefined && h.orderId !== '') lists = await this.readCaptures(h.orderId);
    const captures = lists === null ? null : lists.captures;
    const capturedCents = captures === null ? 0 : captures.reduce((s, c) => s + c.amountCents, 0);
    if (
      captures !== null &&
      captures.length > 0 &&
      (status === 'CREATED' || status === 'PENDING')
    ) {
      // The order shows money taken before the authorization status caught up.
      status = captures.some((c) => c.final) ? 'CAPTURED' : 'PARTIALLY_CAPTURED';
    }
    return {
      holdId: h.holdId,
      authId: h.authId,
      status,
      amountCents: auth.amountCents,
      capturedCents,
      captures,
      ...(lists !== null && lists.declined.length > 0 ? { declined: lists.declined } : {}),
      observedAtMs,
    };
  }

  private async readCaptures(orderId: string): Promise<CaptureLists> {
    const res = await this.auth.send({
      method: 'GET',
      path: `${ORDERS_PATH}/${encodeURIComponent(orderId)}`,
      op: 'get',
      headers: { Accept: 'application/json' },
    });
    if (res.status < 200 || res.status >= 300) {
      const err = classifyError(res.status, res.headers, res.text);
      // The authorization was just read, so the hold exists: a 404 on its order is a read
      // that failed, and it says nothing about the captures.
      if (err.kind === 'not_found') throw orderUnreadable(res.status, 'not found', err.debugId);
      throw err;
    }
    let json: unknown;
    try {
      json = JSON.parse(res.text);
    } catch {
      throw orderUnreadable(res.status, 'body is not JSON');
    }
    const lists = captureListsOf(json);
    if (lists === null) throw orderUnreadable(res.status, 'captures cannot be read');
    return lists;
  }

  async capture(
    authId: string,
    i: { amountCents: number; finalCapture: boolean; invoiceId: string; requestId: string },
  ): Promise<{ captureId: string; amountCents: number }> {
    await this.gate();
    return this.payments.capture(authId, i);
  }

  voidAuthorization(authId: string, requestId: string): Promise<void> {
    return this.payments.voidAuthorization(authId, requestId);
  }

  async reauthorize(
    authId: string,
    i: { amountCents: number; requestId: string },
  ): Promise<{ authId: string; amountCents: number }> {
    await this.gate();
    return this.payments.reauthorize(authId, i);
  }
}
