import { classifyError } from '../errorMap.js';
import type { TokenManager } from '../oauth.js';

/**
 * Webhook signature verification (SPEC 3.7, R-PAY-090, R-PAY-091).
 *
 * The check is PayPal's own: POST /v1/notifications/verify-webhook-signature with
 * the five transmission headers, our webhook id and the event. Only
 * `verification_status === "SUCCESS"` accepts.
 *
 * The event is spliced into the request as the original bytes. It is parsed once
 * to prove it is a single JSON object (so the splice cannot inject other fields
 * into the envelope), but the parsed value is never serialized again: the bytes
 * PayPal signed are the bytes PayPal verifies. UNVERIFIED (G4): whether
 * re-serialization would also pass. Fallback: keep raw splicing regardless.
 */

export type VerifyAuth = Pick<TokenManager, 'send'>;

/** Header bag of a Node request, a Fetch Headers object or a plain record. */
export type WebhookHeaders =
  | { get(name: string): string | null }
  | Readonly<Record<string, string | readonly string[] | undefined>>;

export const VERIFY_PATH = '/v1/notifications/verify-webhook-signature';

export const TRANSMISSION_HEADERS = {
  authAlgo: 'PAYPAL-AUTH-ALGO',
  certUrl: 'PAYPAL-CERT-URL',
  transmissionId: 'PAYPAL-TRANSMISSION-ID',
  transmissionSig: 'PAYPAL-TRANSMISSION-SIG',
  transmissionTime: 'PAYPAL-TRANSMISSION-TIME',
} as const;

export type RejectReason =
  | 'missing_header'
  | 'malformed_body'
  | 'verification_failed'
  | 'unreadable_answer';

export type VerifyOutcome = { ok: true } | { ok: false; reason: RejectReason };

function headerOf(headers: WebhookHeaders, name: string): string | undefined {
  if (typeof (headers as { get?: unknown }).get === 'function') {
    const v = (headers as { get(n: string): string | null }).get(name);
    return v === null || v === '' ? undefined : v;
  }
  const bag = headers as Readonly<Record<string, string | readonly string[] | undefined>>;
  const lower = name.toLowerCase();
  for (const key of Object.keys(bag)) {
    if (key.toLowerCase() !== lower) continue;
    const v = bag[key];
    const first = typeof v === 'string' ? v : Array.isArray(v) ? v[0] : undefined;
    return typeof first === 'string' && first !== '' ? first : undefined;
  }
  return undefined;
}

/**
 * The event text as sent, or undefined when it is not valid UTF-8 or not exactly
 * one JSON object.
 */
export function readRawEvent(rawBody: Buffer | string): string | undefined {
  let text: string;
  if (typeof rawBody === 'string') text = rawBody;
  else {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(rawBody);
    } catch {
      return undefined;
    }
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  } catch {
    return undefined;
  }
  return text;
}

/**
 * Body of the verify request. `rawEvent` is spliced in untouched; every other
 * field goes through JSON.stringify.
 */
export function buildVerifyBody(
  rawEvent: string,
  transmission: Readonly<Record<keyof typeof TRANSMISSION_HEADERS, string>>,
  webhookId: string,
): string {
  const s = (v: string): string => JSON.stringify(v);
  return (
    '{' +
    `"auth_algo":${s(transmission.authAlgo)},` +
    `"cert_url":${s(transmission.certUrl)},` +
    `"transmission_id":${s(transmission.transmissionId)},` +
    `"transmission_sig":${s(transmission.transmissionSig)},` +
    `"transmission_time":${s(transmission.transmissionTime)},` +
    `"webhook_id":${s(webhookId)},` +
    `"webhook_event":${rawEvent}` +
    '}'
  );
}

export class WebhookVerifier {
  private readonly auth: VerifyAuth;
  private readonly webhookId: string;

  constructor(opts: { auth: VerifyAuth; webhookId: string }) {
    this.auth = opts.auth;
    this.webhookId = opts.webhookId;
  }

  /**
   * Verifies one delivery. Returns `{ok:false}` for anything that is not a valid,
   * signed event. Throws a PayPalError when PayPal cannot be asked (network,
   * 5xx, auth), because that says nothing about the sender: the caller should
   * answer with a retryable status, not reject the event.
   */
  async verifyWebhook(rawBody: Buffer | string, headers: WebhookHeaders): Promise<VerifyOutcome> {
    const transmission = {
      authAlgo: headerOf(headers, TRANSMISSION_HEADERS.authAlgo),
      certUrl: headerOf(headers, TRANSMISSION_HEADERS.certUrl),
      transmissionId: headerOf(headers, TRANSMISSION_HEADERS.transmissionId),
      transmissionSig: headerOf(headers, TRANSMISSION_HEADERS.transmissionSig),
      transmissionTime: headerOf(headers, TRANSMISSION_HEADERS.transmissionTime),
    };
    const { authAlgo, certUrl, transmissionId, transmissionSig, transmissionTime } = transmission;
    if (
      authAlgo === undefined ||
      certUrl === undefined ||
      transmissionId === undefined ||
      transmissionSig === undefined ||
      transmissionTime === undefined
    ) {
      return { ok: false, reason: 'missing_header' };
    }
    const rawEvent = readRawEvent(rawBody);
    if (rawEvent === undefined) return { ok: false, reason: 'malformed_body' };

    const res = await this.auth.send({
      method: 'POST',
      path: VERIFY_PATH,
      op: 'verify_webhook',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: buildVerifyBody(
        rawEvent,
        { authAlgo, certUrl, transmissionId, transmissionSig, transmissionTime },
        this.webhookId,
      ),
    });
    if (res.status < 200 || res.status >= 300)
      throw classifyError(res.status, res.headers, res.text);
    let status: unknown;
    try {
      status = (JSON.parse(res.text) as { verification_status?: unknown }).verification_status;
    } catch {
      return { ok: false, reason: 'unreadable_answer' };
    }
    return status === 'SUCCESS' ? { ok: true } : { ok: false, reason: 'verification_failed' };
  }
}
