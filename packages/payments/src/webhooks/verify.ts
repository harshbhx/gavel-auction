import { createHash } from 'node:crypto';
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
  | 'unreadable_answer'
  | 'precheck_failed'
  | 'rate_limited';

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

/** Signature algorithms PayPal documents for webhook deliveries. */
const PAYPAL_AUTH_ALGOS: ReadonlySet<string> = new Set([
  'SHA256withRSA',
  'SHA256WITHRSA',
  'SHA1withRSA',
  'SHA1WITHRSA',
]);

/** Hosts that serve PayPal's webhook certificates. */
function isPayPalCertUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return false;
  const host = url.hostname.toLowerCase();
  return host === 'paypal.com' || host.endsWith('.paypal.com');
}

/** Most delivery fingerprints kept for the local replay filter. */
const MAX_REMEMBERED = 1024;
const BASE64_SHAPE = /^[A-Za-z0-9+/_-]{4,2048}={0,2}$/;
const TRANSMISSION_ID_SHAPE = /^[A-Za-z0-9._:-]{1,128}$/;

export interface WebhookVerifierOptions {
  auth: VerifyAuth;
  webhookId: string;
  /**
   * Fake mode for tests and the fake PayPal server: skips the algorithm, certificate
   * host and age checks (fake deliveries use a local certificate URL and a fake clock)
   * and leaves the call limit off unless `maxCallsPerWindow` is given.
   */
  fake?: boolean;
  /** Clock for the age check and the call limit. Defaults to Date.now. */
  nowMs?: () => number;
  /** Largest accepted distance between transmission time and now. Default 10 minutes. */
  maxSkewMs?: number;
  /** Most calls to PayPal's verify endpoint per window. Default 120 (live), unlimited (fake). */
  maxCallsPerWindow?: number;
  /** Length of the call-limit window. Default 60 seconds. */
  windowMs?: number;
  /**
   * Most calls to PayPal one source (the caller passes a peer address or the like
   * to `verifyWebhook`) may use per window. Default a quarter of `maxCallsPerWindow`.
   * Only applied when a source is given.
   */
  maxCallsPerSource?: number;
}

export class WebhookVerifier {
  private readonly auth: VerifyAuth;
  private readonly webhookId: string;
  private readonly fake: boolean;
  private readonly nowMs: () => number;
  private readonly maxSkewMs: number;
  private readonly maxCalls: number;
  private readonly windowMs: number;
  private windowStartMs = 0;
  private callsInWindow = 0;
  private readonly perSource = new Map<string, number>();
  private readonly maxCallsPerSource: number;
  /**
   * Fingerprints of deliveries PayPal already answered, byte for byte (transmission id,
   * signature, time, certificate url and body), with the answer and when it lapses. A
   * repeat is answered here without a call: PayPal retries a transmission unchanged,
   * and a forger who repeats a request gains nothing. Bounded, oldest dropped first.
   */
  private readonly answered = new Map<string, { ok: boolean; untilMs: number }>();

  constructor(opts: WebhookVerifierOptions) {
    this.auth = opts.auth;
    this.webhookId = opts.webhookId;
    this.fake = opts.fake === true;
    this.nowMs = opts.nowMs ?? Date.now;
    this.maxSkewMs = opts.maxSkewMs ?? 10 * 60_000;
    this.maxCalls = opts.maxCallsPerWindow ?? (this.fake ? Number.POSITIVE_INFINITY : 120);
    this.windowMs = opts.windowMs ?? 60_000;
    this.maxCallsPerSource =
      opts.maxCallsPerSource ?? Math.max(1, Math.ceil(this.maxCalls / 4));
  }

  /** Checks that need no call to PayPal. */
  private passesPrechecks(authAlgo: string, certUrl: string, transmissionTime: string): boolean {
    if (this.fake) return true;
    if (!PAYPAL_AUTH_ALGOS.has(authAlgo) || !isPayPalCertUrl(certUrl)) return false;
    const sentMs = Date.parse(transmissionTime);
    if (Number.isNaN(sentMs)) return false;
    return Math.abs(this.nowMs() - sentMs) <= this.maxSkewMs;
  }

  /**
   * Takes one slot of the call limit; false when the window is used up. A quoted
   * certificate url proves nothing (it is public, PayPal sends it with every
   * delivery), so no part of the window is reserved by it. Instead one source can
   * use only a share of the window when the caller names it, and repeated requests
   * are answered from `answered` without a slot (R8-P07).
   */
  private takeCallSlot(source: string | undefined): boolean {
    const now = this.nowMs();
    if (now - this.windowStartMs >= this.windowMs || now < this.windowStartMs) {
      this.windowStartMs = now;
      this.callsInWindow = 0;
      this.perSource.clear();
    }
    if (this.callsInWindow >= this.maxCalls) return false;
    if (source !== undefined) {
      const used = this.perSource.get(source) ?? 0;
      if (used >= this.maxCallsPerSource) return false;
      this.perSource.set(source, used + 1);
    }
    this.callsInWindow += 1;
    return true;
  }

  private fingerprint(
    rawEvent: string,
    t: { certUrl: string; transmissionId: string; transmissionSig: string; transmissionTime: string },
  ): string {
    return createHash('sha256')
      .update(JSON.stringify([t.transmissionId, t.transmissionSig, t.transmissionTime, t.certUrl]))
      .update('\n')
      .update(rawEvent)
      .digest('hex');
  }

  private remember(key: string, ok: boolean): void {
    this.answered.delete(key);
    // A success stays as long as the delivery could still pass the age check; a failure only
    // for a window, so a transient mistake is not remembered for long.
    this.answered.set(key, { ok, untilMs: this.nowMs() + (ok ? this.maxSkewMs : this.windowMs) });
    if (this.answered.size > MAX_REMEMBERED) {
      const oldest = this.answered.keys().next().value;
      if (oldest !== undefined) this.answered.delete(oldest);
    }
  }

  /**
   * Verifies one delivery. Returns `{ok:false}` for anything that is not a valid,
   * signed event. Throws a PayPalError when PayPal cannot be asked (network,
   * 5xx, auth), because that says nothing about the sender: the caller should
   * answer with a retryable status, not reject the event.
   */
  async verifyWebhook(
    rawBody: Buffer | string,
    headers: WebhookHeaders,
    source?: string,
  ): Promise<VerifyOutcome> {
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
    if (
      !this.passesPrechecks(authAlgo, certUrl, transmissionTime) ||
      (!this.fake &&
        (!BASE64_SHAPE.test(transmissionSig) || !TRANSMISSION_ID_SHAPE.test(transmissionId)))
    ) {
      return { ok: false, reason: 'precheck_failed' };
    }
    const key = this.fingerprint(rawEvent, {
      certUrl,
      transmissionId,
      transmissionSig,
      transmissionTime,
    });
    const seen = this.answered.get(key);
    if (seen !== undefined && seen.untilMs > this.nowMs()) {
      return seen.ok ? { ok: true } : { ok: false, reason: 'verification_failed' };
    }
    if (!this.takeCallSlot(source)) return { ok: false, reason: 'rate_limited' };

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
    if (status !== 'SUCCESS') {
      this.remember(key, false);
      return { ok: false, reason: 'verification_failed' };
    }
    this.remember(key, true);
    return { ok: true };
  }
}
