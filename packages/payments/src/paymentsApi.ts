import { classifyError } from './errorMap.js';
import { PayPalError } from './errors.js';
import { centsToDecimal, decimalToCents } from './money.js';
import type { TokenManager } from './oauth.js';
import type { TransportResult } from './transport.js';

/**
 * Payments v2 client (SPEC 3.2, R-PAY-012, R-PAY-051): getAuthorization, capture,
 * void and reauthorize. Every POST carries the caller's PayPal-Request-Id, and
 * the transport reuses it on each retry, so a retried capture cannot capture
 * twice. Failed calls are thrown as PayPalError with the classified outcome.
 *
 * UNVERIFIED (G1): that `invoice_id` is accepted on capture and echoed back.
 * Fallback: the saga identifies a capture by amount, time window and intent.
 * UNVERIFIED (G3): whether and when reauthorize is allowed. It is a plain method
 * here; nothing calls it except an explicit caller (R-PAY-110).
 */

export type PaymentsAuth = Pick<TokenManager, 'send'>;

export interface AuthorizationView {
  authId: string;
  /** PayPal status string, for example CREATED, CAPTURED, VOIDED. */
  status: string;
  amountCents: number;
}

export interface CaptureInput {
  amountCents: number;
  finalCapture: boolean;
  invoiceId: string;
  requestId: string;
}

export const AUTHORIZATIONS_PATH = '/v2/payments/authorizations';
const CURRENCY = 'USD';
const JSON_HEADERS: Readonly<Record<string, string>> = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
};
/**
 * PayPal answers a capture or a reauthorization with the minimal body (id, status, links)
 * unless the request asks for the full resource (R11-O02, G1.5 evidence). The client asks,
 * and still accepts the minimal body.
 */
export const PREFER_REPRESENTATION = 'return=representation';

type Json = Record<string, unknown>;

function parseJson(text: string): Json | undefined {
  try {
    const v: unknown = JSON.parse(text);
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : undefined;
  } catch {
    return undefined;
  }
}

function nonEmpty(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined;
}

function centsOf(amount: unknown): number | undefined {
  if (amount === null || typeof amount !== 'object') return undefined;
  const a = amount as Json;
  if (a['currency_code'] !== CURRENCY || typeof a['value'] !== 'string') return undefined;
  try {
    return decimalToCents(a['value']);
  } catch {
    return undefined;
  }
}

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

/** A 2xx answer that cannot be read: the call took effect, the details are unknown. */
function malformed(res: TransportResult, what: string): PayPalError {
  return new PayPalError({
    kind: 'server_error',
    status: res.status,
    name: 'MALFORMED_RESPONSE',
    message: `${what} response could not be read`,
    outcome: 'unknown',
  });
}

function amountBody(cents: number): { currency_code: string; value: string } {
  return { currency_code: CURRENCY, value: centsToDecimal(cents) };
}

export class PaymentsApiClient {
  private readonly auth: PaymentsAuth;

  constructor(opts: { auth: PaymentsAuth }) {
    this.auth = opts.auth;
  }

  private path(authId: string, action?: string): string {
    const base = `${AUTHORIZATIONS_PATH}/${encodeURIComponent(authId)}`;
    return action === undefined ? base : `${base}/${action}`;
  }

  /** GET /v2/payments/authorizations/{id}. Read only. */
  async getAuthorization(authId: string): Promise<AuthorizationView> {
    const res = await this.auth.send({
      method: 'GET',
      path: this.path(authId),
      op: 'get',
      headers: { Accept: 'application/json' },
    });
    if (!isSuccess(res.status)) throw classifyError(res.status, res.headers, res.text);
    const json = parseJson(res.text);
    const status = json === undefined ? undefined : nonEmpty(json['status']);
    const amountCents = json === undefined ? undefined : centsOf(json['amount']);
    if (json === undefined || status === undefined || amountCents === undefined) {
      throw malformed(res, 'authorization');
    }
    return { authId: nonEmpty(json['id']) ?? authId, status, amountCents };
  }

  /**
   * POST .../capture with `amount`, `final_capture` and `invoice_id` exactly as
   * R-PAY-051 states, and `Prefer: return=representation`. Returns the capture id
   * and the amount captured. A capture counts as taken only when PayPal says
   * COMPLETED: DECLINED or FAILED is a definite `declined`; PENDING is an unknown
   * outcome (`CAPTURE_PENDING`), as is any other status (read the authorization
   * before acting).
   *
   * R11-O02: without the representation PayPal answers COMPLETED with no amount
   * and no `final_capture` (G1.5). A COMPLETED capture of an explicit amount took
   * that amount, so the minimal answer is a capture of the requested amount. An
   * amount or `final_capture` that the answer does state must match the request,
   * else the outcome is unknown.
   */
  async capture(
    authId: string,
    i: CaptureInput,
  ): Promise<{ captureId: string; amountCents: number }> {
    const res = await this.auth.send({
      method: 'POST',
      path: this.path(authId, 'capture'),
      op: 'capture',
      requestId: i.requestId,
      headers: { ...JSON_HEADERS, Prefer: PREFER_REPRESENTATION },
      body: JSON.stringify({
        amount: amountBody(i.amountCents),
        final_capture: i.finalCapture,
        invoice_id: i.invoiceId,
      }),
    });
    if (!isSuccess(res.status)) throw classifyError(res.status, res.headers, res.text);
    const json = parseJson(res.text);
    const captureId = json === undefined ? undefined : nonEmpty(json['id']);
    if (json === undefined || captureId === undefined) throw malformed(res, 'capture');
    const status = nonEmpty(json['status']);
    if (status === 'DECLINED' || status === 'FAILED') {
      throw new PayPalError({
        kind: 'declined',
        status: res.status,
        name: `CAPTURE_${status}`,
        message: `capture ${status.toLowerCase()}`,
        outcome: 'definite',
      });
    }
    if (status === 'PENDING') {
      // R11-O03: PayPal may still complete or decline it; the truth read decides later.
      throw new PayPalError({
        kind: 'server_error',
        status: res.status,
        name: 'CAPTURE_PENDING',
        message: 'capture pending at PayPal',
        outcome: 'unknown',
      });
    }
    if (status !== 'COMPLETED') throw malformed(res, 'capture');
    const amount = json['amount'];
    if (amount !== undefined && centsOf(amount) !== i.amountCents) throw malformed(res, 'capture');
    const final = json['final_capture'];
    if (final !== undefined && final !== i.finalCapture) throw malformed(res, 'capture');
    return { captureId, amountCents: i.amountCents };
  }

  /**
   * POST .../void. Resolves on 2xx (PayPal answers 204). An authorization that
   * is already voided, expired or unknown is thrown with its classified kind
   * (`already_voided`, `expired`, `not_found`, all definite); the saga counts
   * those as released.
   */
  async voidAuthorization(authId: string, requestId: string): Promise<void> {
    const res = await this.auth.send({
      method: 'POST',
      path: this.path(authId, 'void'),
      op: 'void',
      requestId,
      headers: { ...JSON_HEADERS },
      body: '{}',
    });
    if (!isSuccess(res.status)) throw classifyError(res.status, res.headers, res.text);
  }

  /**
   * POST .../reauthorize with the new amount. Explicit call only: no other method
   * of this client calls it. UNVERIFIED (G3).
   *
   * R11-O06: PayPal answers with a new authorization resource that has its own id;
   * the funds are held under that id from now on. The id is required: an answer
   * without one is an unknown outcome, since the caller could not track the hold.
   */
  async reauthorize(
    authId: string,
    i: { amountCents: number; requestId: string },
  ): Promise<{ authId: string; amountCents: number }> {
    const res = await this.auth.send({
      method: 'POST',
      path: this.path(authId, 'reauthorize'),
      op: 'reauthorize',
      requestId: i.requestId,
      headers: { ...JSON_HEADERS, Prefer: PREFER_REPRESENTATION },
      body: JSON.stringify({ amount: amountBody(i.amountCents) }),
    });
    if (!isSuccess(res.status)) throw classifyError(res.status, res.headers, res.text);
    const json = parseJson(res.text);
    const newId = json === undefined ? undefined : nonEmpty(json['id']);
    if (json === undefined || newId === undefined) throw malformed(res, 'reauthorize');
    return { authId: newId, amountCents: centsOf(json['amount']) ?? i.amountCents };
  }
}
