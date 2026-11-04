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
   * R-PAY-051 states. Returns the capture id and the amount PayPal reports, or
   * the requested amount when the answer does not carry one.
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
      headers: { ...JSON_HEADERS },
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
    return { captureId, amountCents: centsOf(json['amount']) ?? i.amountCents };
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
   */
  async reauthorize(
    authId: string,
    i: { amountCents: number; requestId: string },
  ): Promise<{ amountCents: number }> {
    const res = await this.auth.send({
      method: 'POST',
      path: this.path(authId, 'reauthorize'),
      op: 'reauthorize',
      requestId: i.requestId,
      headers: { ...JSON_HEADERS },
      body: JSON.stringify({ amount: amountBody(i.amountCents) }),
    });
    if (!isSuccess(res.status)) throw classifyError(res.status, res.headers, res.text);
    const json = parseJson(res.text);
    if (json === undefined) throw malformed(res, 'reauthorize');
    return { amountCents: centsOf(json['amount']) ?? i.amountCents };
  }
}
