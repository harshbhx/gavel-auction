import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FakeWebhookEvent } from './core.js';

/**
 * Fake webhook emitter (SPEC 3.10 R-PAY-126).
 *
 * Takes the outbox of the fake core and produces the deliveries a receiver would
 * see: ordering (fifo, reverse, shuffle with a seed), duplication, dropping and
 * delay, each signed with a fake HMAC scheme that the fake verify endpoint
 * understands. The fake signature covers transmission id, transmission time,
 * webhook id and the raw body, with a fixed test key. It is NOT PayPal's scheme
 * (UNVERIFIED, gate G4: the real one is a CRC32 and RSA certificate check done by
 * PayPal's verify endpoint); the receiver still goes through the verify endpoint,
 * so only the endpoint differs.
 */

export const FAKE_SIGNING_KEY = 'gavel-fake-webhook-key';
export const FAKE_AUTH_ALGO = 'FAKE-HMAC-SHA256';
export const FAKE_CERT_URL = 'http://127.0.0.1/__fake/cert';

export type DeliveryOrder = 'fifo' | 'reverse' | { shuffle: number };

export interface DeliveryOptions {
  /** Order of first deliveries. Default fifo. */
  order?: DeliveryOrder;
  /** Every delivered event is delivered a second time after the first pass. */
  duplicate?: boolean;
  /** Event ids that are never delivered, or "all". */
  drop?: readonly string[] | 'all';
  /** Delay in ms attached to every delivery. */
  delayMs?: number;
}

export interface ScheduledDelivery {
  event: FakeWebhookEvent;
  /** 0 for the first delivery, 1 for the duplicate. */
  copy: number;
  delayMs: number;
}

/** mulberry32: small seeded PRNG, stable across platforms. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  const rand = prng(seed);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return out;
}

/** Pure: which deliveries happen, in which order, with which delay. */
export function planDeliveries(
  events: readonly FakeWebhookEvent[],
  opts: DeliveryOptions = {},
): ScheduledDelivery[] {
  const dropped = opts.drop === 'all' ? null : new Set(opts.drop ?? []);
  if (dropped === null) return [];
  const kept = events.filter((e) => !dropped.has(e.id));
  const order = opts.order ?? 'fifo';
  let first = [...kept];
  if (order === 'reverse') first.reverse();
  else if (typeof order === 'object') first = shuffled(kept, order.shuffle);
  const delayMs = opts.delayMs ?? 0;
  const out: ScheduledDelivery[] = first.map((event) => ({ event, copy: 0, delayMs }));
  if (opts.duplicate === true) {
    const again = typeof order === 'object' ? shuffled(first, order.shuffle + 1) : first;
    for (const event of again) out.push({ event, copy: 1, delayMs });
  }
  return out;
}

export interface SignatureParts {
  transmissionId: string;
  transmissionTime: string;
  webhookId: string;
  rawBody: string;
}

/** HMAC-SHA256 hex over transmission id, time, webhook id and the raw body. */
export function signWebhook(parts: SignatureParts, key: string = FAKE_SIGNING_KEY): string {
  const mac = createHmac('sha256', key);
  mac.update(`${parts.transmissionId}|${parts.transmissionTime}|${parts.webhookId}|`);
  mac.update(parts.rawBody);
  return mac.digest('hex');
}

/** The JSON body of a webhook event as the fake sends it. */
export function eventBody(event: FakeWebhookEvent, createTime: string): string {
  return JSON.stringify({
    id: event.id,
    event_type: event.eventType,
    create_time: createTime,
    resource: event.resource,
  });
}

export interface SignedWebhook {
  /** Header names as PayPal sends them, upper case. */
  headers: Record<string, string>;
  rawBody: string;
  eventId: string;
}

export interface EmitterOptions {
  webhookId: string;
  /** Signing key. Default FAKE_SIGNING_KEY. */
  key?: string;
  /** Current time in ms, for transmission and create times. */
  nowMs: () => number;
}

/** Signs outbox events and plans their delivery. */
export class WebhookEmitter {
  private transmissions = 0;
  private readonly key: string;

  constructor(private readonly opts: EmitterOptions) {
    this.key = opts.key ?? FAKE_SIGNING_KEY;
  }

  sign(event: FakeWebhookEvent): SignedWebhook {
    this.transmissions += 1;
    const transmissionId = `TX-${this.transmissions}`;
    const iso = new Date(this.opts.nowMs()).toISOString();
    const rawBody = eventBody(event, iso);
    const sig = signWebhook(
      { transmissionId, transmissionTime: iso, webhookId: this.opts.webhookId, rawBody },
      this.key,
    );
    return {
      eventId: event.id,
      rawBody,
      headers: {
        'PAYPAL-AUTH-ALGO': FAKE_AUTH_ALGO,
        'PAYPAL-CERT-URL': FAKE_CERT_URL,
        'PAYPAL-TRANSMISSION-ID': transmissionId,
        'PAYPAL-TRANSMISSION-SIG': sig,
        'PAYPAL-TRANSMISSION-TIME': iso,
      },
    };
  }

  /** Signed deliveries in the order a receiver gets them. */
  prepare(
    events: readonly FakeWebhookEvent[],
    opts: DeliveryOptions = {},
  ): Array<SignedWebhook & { copy: number; delayMs: number }> {
    return planDeliveries(events, opts).map((d) => ({
      ...this.sign(d.event),
      copy: d.copy,
      delayMs: d.delayMs,
    }));
  }

  /**
   * Delivers to a sink, waiting each delivery's delay on the injected sleep.
   * Returns how many deliveries were made.
   */
  async deliver(
    events: readonly FakeWebhookEvent[],
    sink: (d: SignedWebhook) => Promise<void> | void,
    sleep: (ms: number) => Promise<void>,
    opts: DeliveryOptions = {},
  ): Promise<number> {
    const planned = this.prepare(events, opts);
    for (const d of planned) {
      if (d.delayMs > 0) await sleep(d.delayMs);
      await sink(d);
    }
    return planned.length;
  }
}

/**
 * Returns the raw text of the `webhook_event` value in a verify request, without
 * parsing and re-serialising it (R-PAY-091: the bytes that were signed are the
 * bytes that get verified). Brace matching is string aware. Returns null when the
 * field is missing or the object is unbalanced.
 */
export function extractRawEvent(requestBody: string): string | null {
  const m = /"webhook_event"\s*:\s*/.exec(requestBody);
  if (m === null) return null;
  const start = m.index + m[0].length;
  if (requestBody[start] !== '{') return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < requestBody.length; i += 1) {
    const ch = requestBody[i];
    if (inString) {
      if (ch === '\\') i += 1;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return requestBody.slice(start, i + 1);
    }
  }
  return null;
}

/** Builds the body of POST /v1/notifications/verify-webhook-signature by raw splicing. */
export function buildVerifyRequest(w: SignedWebhook, webhookId: string): string {
  const h = (name: string): string => JSON.stringify(w.headers[name] ?? '');
  return (
    '{' +
    `"auth_algo":${h('PAYPAL-AUTH-ALGO')},` +
    `"cert_url":${h('PAYPAL-CERT-URL')},` +
    `"transmission_id":${h('PAYPAL-TRANSMISSION-ID')},` +
    `"transmission_sig":${h('PAYPAL-TRANSMISSION-SIG')},` +
    `"transmission_time":${h('PAYPAL-TRANSMISSION-TIME')},` +
    `"webhook_id":${JSON.stringify(webhookId)},` +
    `"webhook_event":${w.rawBody}` +
    '}'
  );
}

export interface VerifyResult {
  verification_status: 'SUCCESS' | 'FAILURE';
}

function equalHex(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * The fake verify endpoint: recomputes the HMAC over the transmission id, time,
 * the configured webhook id and the raw event text. Anything malformed, a wrong
 * webhook id, a wrong algorithm or an altered body is FAILURE.
 */
export function verifyFakeWebhook(
  requestBody: string,
  expectedWebhookId: string,
  key: string = FAKE_SIGNING_KEY,
): VerifyResult {
  const failure: VerifyResult = { verification_status: 'FAILURE' };
  const rawEvent = extractRawEvent(requestBody);
  if (rawEvent === null) return failure;
  let parsed: unknown;
  try {
    parsed = JSON.parse(requestBody);
  } catch {
    return failure;
  }
  if (parsed === null || typeof parsed !== 'object') return failure;
  const o = parsed as Record<string, unknown>;
  const id = o['transmission_id'];
  const time = o['transmission_time'];
  const sig = o['transmission_sig'];
  const webhookId = o['webhook_id'];
  if (
    typeof id !== 'string' ||
    typeof time !== 'string' ||
    typeof sig !== 'string' ||
    typeof webhookId !== 'string'
  ) {
    return failure;
  }
  if (o['auth_algo'] !== FAKE_AUTH_ALGO) return failure;
  if (webhookId !== expectedWebhookId) return failure;
  const expected = signWebhook(
    { transmissionId: id, transmissionTime: time, webhookId, rawBody: rawEvent },
    key,
  );
  return equalHex(sig, expected) ? { verification_status: 'SUCCESS' } : failure;
}
