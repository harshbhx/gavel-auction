import { assertApproveUrl } from './guard.js';
import { classifyError } from './errorMap.js';
import { PayPalError } from './errors.js';
import { centsToDecimal, decimalToCents } from './money.js';
import type { TokenManager } from './oauth.js';
import type { TransportResult } from './transport.js';

/**
 * Orders v2 client (SPEC 3.2, R-PAY-011, R-PAY-003): createOrder, getOrder and
 * authorizeOrder. All calls go through the token manager, so they carry a bearer
 * token, the transport's retry policy and the request id passed by the caller.
 *
 * UNVERIFIED (G2): the exact shape of the order and authorization responses for
 * SDK v6 AUTHORIZE flows. The parsers read only the documented fields and treat
 * everything else as absent. Fallback: the saga reads the hold through
 * getHoldTruth, which does not depend on these fields.
 */

export type OrdersAuth = Pick<TokenManager, 'send'>;

export interface OrdersClientOptions {
  auth: OrdersAuth;
  /** True only in fake mode (GAVEL_PAYMENTS_FAKE=1): loopback approve links pass the guard. */
  fake: boolean;
}

export interface CreateOrderInput {
  holdId: string;
  ceilingCents: number;
  description: string;
  requestId: string;
}

export interface OrderView {
  orderId: string;
  status: string;
  authId?: string;
}

export const ORDERS_PATH = '/v2/checkout/orders';
const CURRENCY = 'USD';
/** PayPal limits purchase unit descriptions to 127 characters. */
export const MAX_DESCRIPTION_LENGTH = 127;
const JSON_HEADERS: Readonly<Record<string, string>> = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

type Json = Record<string, unknown>;

function asObject(v: unknown): Json | undefined {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : undefined;
}

function nonEmpty(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined;
}

function parseJson(text: string): Json | undefined {
  try {
    return asObject(JSON.parse(text));
  } catch {
    return undefined;
  }
}

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

/**
 * A 2xx answer that cannot be read. The request reached PayPal and was accepted,
 * so the effect is unknown: callers must read the order or the hold.
 */
function malformed(res: TransportResult, what: string): PayPalError {
  return new PayPalError({
    kind: 'server_error',
    status: res.status,
    name: 'MALFORMED_RESPONSE',
    message: `${what} response could not be read`,
    outcome: 'unknown',
  });
}

function unit(order: Json): Json | undefined {
  const units = order['purchase_units'];
  return Array.isArray(units) ? asObject(units[0]) : undefined;
}

function firstAuthorization(order: Json): Json | undefined {
  const payments = asObject(unit(order)?.['payments']);
  const list = payments?.['authorizations'];
  return Array.isArray(list) ? asObject(list[0]) : undefined;
}

/** purchase_units[0].payments.authorizations[0].id (R-PAY-011), or undefined. */
export function extractAuthorizationId(order: unknown): string | undefined {
  const o = asObject(order);
  return o === undefined ? undefined : nonEmpty(firstAuthorization(o)?.['id']);
}

function centsOf(amount: unknown): number | undefined {
  const a = asObject(amount);
  if (a === undefined || a['currency_code'] !== CURRENCY) return undefined;
  const value = a['value'];
  if (typeof value !== 'string') return undefined;
  try {
    return decimalToCents(value);
  } catch {
    return undefined;
  }
}

function approveHref(order: Json): string | undefined {
  const links = order['links'];
  if (!Array.isArray(links)) return undefined;
  for (const l of links) {
    const link = asObject(l);
    if (link?.['rel'] === 'approve') return nonEmpty(link['href']);
  }
  return undefined;
}

export class OrdersClient {
  private readonly auth: OrdersAuth;
  private readonly fake: boolean;

  constructor(opts: OrdersClientOptions) {
    this.auth = opts.auth;
    this.fake = opts.fake;
  }

  /**
   * POST /v2/checkout/orders with intent AUTHORIZE and one purchase unit whose
   * reference_id and custom_id are the hold id. The approve link passes the
   * guard (R-PAY-003); a link that does not is an error and the order is dropped.
   */
  async createOrder(i: CreateOrderInput): Promise<{ orderId: string; approveUrl?: string }> {
    const body = {
      intent: 'AUTHORIZE',
      purchase_units: [
        {
          reference_id: i.holdId,
          custom_id: i.holdId,
          description: i.description.slice(0, MAX_DESCRIPTION_LENGTH),
          amount: { currency_code: CURRENCY, value: centsToDecimal(i.ceilingCents) },
        },
      ],
    };
    const res = await this.auth.send({
      method: 'POST',
      path: ORDERS_PATH,
      op: 'order',
      requestId: i.requestId,
      holdId: i.holdId,
      headers: { ...JSON_HEADERS },
      body: JSON.stringify(body),
    });
    if (!isSuccess(res.status)) throw classifyError(res.status, res.headers, res.text);
    const json = parseJson(res.text);
    const orderId = json === undefined ? undefined : nonEmpty(json['id']);
    if (json === undefined || orderId === undefined) throw malformed(res, 'order');
    const href = approveHref(json);
    if (href === undefined) return { orderId };
    // Throws PaymentsConfigError(payments_not_sandbox) for a foreign host.
    assertApproveUrl(href, { fake: this.fake });
    return { orderId, approveUrl: href };
  }

  /** GET /v2/checkout/orders/{id}. Read only. */
  async getOrder(orderId: string): Promise<OrderView> {
    const res = await this.auth.send({
      method: 'GET',
      path: `${ORDERS_PATH}/${encodeURIComponent(orderId)}`,
      op: 'get',
      headers: { Accept: 'application/json' },
    });
    if (!isSuccess(res.status)) throw classifyError(res.status, res.headers, res.text);
    const json = parseJson(res.text);
    const status = json === undefined ? undefined : nonEmpty(json['status']);
    if (json === undefined || status === undefined) throw malformed(res, 'order');
    const view: OrderView = { orderId: nonEmpty(json['id']) ?? orderId, status };
    const authId = extractAuthorizationId(json);
    if (authId !== undefined) view.authId = authId;
    return view;
  }

  /**
   * POST /v2/checkout/orders/{id}/authorize. Returns the authorization id and the
   * authorized amount. An order the buyer has not approved is a definite
   * `order_not_approved` error; a 2xx answer without an authorization id has an
   * unknown outcome (the authorization may exist; read the order).
   */
  async authorizeOrder(
    orderId: string,
    requestId: string,
  ): Promise<{ authId: string; amountCents: number }> {
    const res = await this.auth.send({
      method: 'POST',
      path: `${ORDERS_PATH}/${encodeURIComponent(orderId)}/authorize`,
      op: 'authorize',
      requestId,
      headers: { ...JSON_HEADERS },
      body: '{}',
    });
    if (!isSuccess(res.status)) {
      const err = classifyError(res.status, res.headers, res.text);
      // UNVERIFIED (G2): the issue name for an order the buyer has not approved.
      if (err.issue === 'ORDER_NOT_APPROVED') throw orderNotApproved(err);
      throw err;
    }
    const json = parseJson(res.text);
    const authId = extractAuthorizationId(json);
    if (json === undefined || authId === undefined) throw malformed(res, 'authorization');
    const auth = firstAuthorization(json);
    const amountCents = centsOf(auth?.['amount']) ?? centsOf(unit(json)?.['amount']);
    if (amountCents === undefined) throw malformed(res, 'authorization');
    return { authId, amountCents };
  }
}

function orderNotApproved(cause: PayPalError): PayPalError {
  const init: ConstructorParameters<typeof PayPalError>[0] = {
    kind: 'rejected',
    status: cause.status,
    name: 'order_not_approved',
    message: 'the buyer has not approved the order',
    outcome: 'definite',
  };
  if (cause.issue !== undefined) init.issue = cause.issue;
  if (cause.debugId !== undefined) init.debugId = cause.debugId;
  return new PayPalError(init);
}
