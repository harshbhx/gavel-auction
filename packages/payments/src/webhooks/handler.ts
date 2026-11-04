import { PayPalError } from '../errors.js';
import type { AuditSink, Clock, PaymentsMetrics } from '../ports.js';
import type { RejectReason, WebhookHeaders, WebhookVerifier } from './verify.js';

/**
 * Webhook route handler (SPEC 3.7, R-PAY-092, R-PAY-093, 6.5).
 *
 * `handle(rawBody, headers)` is what the server route calls with the bytes of the
 * request body, before any JSON parsing. A string or an already parsed object
 * is a wiring bug and throws (R-PAY-092). A delivery that fails verification
 * is answered 401 and leaves one `webhook_rejected` audit row; it never reaches
 * `onVerified`, so settlement and hold state stay untouched (R-PAY-093). When
 * PayPal cannot be asked, the answer is 503 so that PayPal sends the event again.
 *
 * The server owner configures raw-body capture for the webhook route and proves
 * it with `assertRawBodyCapture` (the contract test below).
 */

export interface WebhookResponse {
  status: 200 | 401 | 503;
}

/** A delivery whose signature checked out. Intake (PAY-47 onward) takes it from here. */
export interface VerifiedWebhook {
  rawBody: Buffer;
  headers: WebhookHeaders;
  receivedAtMs: number;
}

export interface WebhookHandlerDeps {
  verifier: Pick<WebhookVerifier, 'verifyWebhook'>;
  audit: AuditSink;
  clock: Clock;
  metrics?: PaymentsMetrics;
  /** Called only for verified deliveries; its failure propagates to the route. */
  onVerified?: (event: VerifiedWebhook) => Promise<void>;
}

export class WebhookHandler {
  constructor(private readonly deps: WebhookHandlerDeps) {}

  async handle(rawBody: Buffer, headers: WebhookHeaders): Promise<WebhookResponse> {
    if (!Buffer.isBuffer(rawBody)) {
      throw new TypeError(
        'webhook handler needs the raw request body as a Buffer; the route parsed it first',
      );
    }
    const { audit, clock, metrics, verifier } = this.deps;
    const receivedAtMs = clock.nowMs();

    let reason: RejectReason | undefined;
    try {
      const outcome = await verifier.verifyWebhook(rawBody, headers);
      if (!outcome.ok) reason = outcome.reason;
    } catch (e) {
      if (!(e instanceof PayPalError)) throw e;
      metrics?.incr('webhook_events_total', { result: 'verify_unavailable' });
      await audit.append({
        kind: 'state_change',
        op: 'webhook_verify',
        label: 'webhook_verify_unavailable',
        status: e.status,
        outcome: e.outcome,
        ...(e.debugId === undefined ? {} : { debugId: e.debugId }),
        tsMs: receivedAtMs,
      });
      return { status: 503 };
    }

    if (reason !== undefined) {
      metrics?.incr('webhook_events_total', { result: 'rejected' });
      // The reason is a fixed code; the body and the signature are never stored here.
      await audit.append({
        kind: 'state_change',
        op: 'webhook_verify',
        label: 'webhook_rejected',
        from: reason,
        tsMs: receivedAtMs,
      });
      return { status: 401 };
    }

    metrics?.incr('webhook_events_total', { result: 'verified' });
    await this.deps.onVerified?.({ rawBody, headers, receivedAtMs });
    return { status: 200 };
  }
}

export function createWebhookHandler(deps: WebhookHandlerDeps): WebhookHandler {
  return new WebhookHandler(deps);
}

/**
 * Bodies a raw-body route must hand to the handler byte for byte: unusual
 * whitespace, key order, escapes, non-ASCII text and a trailing newline.
 */
export const RAW_BODY_SAMPLES: readonly string[] = [
  '{"id":"WH-1","event_type":"PAYMENT.CAPTURE.COMPLETED","resource":{"id":"C1"}}',
  '{\n  "resource" : { "id" : "C2" },\n\t"event_type":"PAYMENT.CAPTURE.COMPLETED",   "id":"WH-2"\n}\n',
  '{"id":"WH-3","summary":"caf\u00e9 \\u00e9 \\" \\\\ \u2603","resource":{"amount":{"value":"10.00"}}}',
  '{"b":1,"a":2,"id":"WH-4","n":1.0,"big":12345678901234567890}',
];

export interface RawBodyContract {
  /**
   * Sends `body` to the server's real webhook route over its real HTTP stack and
   * resolves with the Buffer that the route passed to `WebhookHandler.handle`.
   */
  roundTrip(body: Buffer, headers: Record<string, string>): Promise<Buffer>;
}

/**
 * The contract test the server must pass (R-PAY-092): every sample arrives at the
 * handler with exactly the bytes that were sent, including when the request
 * declares `application/json` (the case where a JSON body parser would normally
 * consume and re-serialize it). Rejects with the list of failing samples.
 */
export async function assertRawBodyCapture(contract: RawBodyContract): Promise<void> {
  const failures: string[] = [];
  for (const sample of RAW_BODY_SAMPLES) {
    const sent = Buffer.from(sample, 'utf8');
    const got = await contract.roundTrip(sent, { 'content-type': 'application/json' });
    if (!Buffer.isBuffer(got) || !got.equals(sent)) failures.push(sample);
  }
  if (failures.length > 0) {
    throw new Error(
      `webhook route does not deliver the raw body byte for byte (${failures.length} of ${RAW_BODY_SAMPLES.length} samples changed)`,
    );
  }
}
