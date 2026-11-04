import { PayPalError } from './errors.js';
import { classifyError, classifyNetworkError, type HeaderBag } from './errorMap.js';
import { logPayment } from './log.js';
import type { PaymentsMetrics } from './ports.js';

/**
 * HTTP transport with retry (SPEC 3.2, R-PAY-014, R-PAY-015).
 *
 * Retries network errors and the statuses 429, 500, 502, 503, 504 with
 * exponential backoff and full jitter: delay = random(0, min(capMs, baseMs * 2^n))
 * where n counts the retries already made. A Retry-After header (seconds or an
 * HTTP date) replaces the computed delay when it is larger, bounded by
 * retryAfterMaxMs. Every attempt of one logical request carries the same
 * PayPal-Request-Id. Sleep, randomness and the clock are injected.
 *
 * Responses that are not retryable are returned as they are; the caller decides
 * whether a 4xx is a failure. When retries run out the last failure is thrown as
 * a PayPalError, never a raw fetch error (R-PAY-018).
 */

export interface TransportResponse {
  status: number;
  headers: HeaderBag;
  text(): Promise<string>;
}

export interface TransportInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export type FetchLike = (url: string, init: TransportInit) => Promise<TransportResponse>;

export interface TransportOptions {
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  /** Uniform in [0, 1). */
  random?: () => number;
  /** Wall clock in ms, used for HTTP-date Retry-After and latency. */
  now?: () => number;
  metrics?: PaymentsMetrics;
  baseMs?: number;
  capMs?: number;
  maxAttempts?: number;
  /** Upper bound for a Retry-After wait. Default 30 s. */
  retryAfterMaxMs?: number;
}

export const DEFAULT_BASE_MS = 250;
export const DEFAULT_CAP_MS = 4000;
export const DEFAULT_MAX_ATTEMPTS = 4;
export const RETRY_AFTER_MAX_MS = 30_000;
export const REQUEST_ID_HEADER = 'PayPal-Request-Id';

const RETRYABLE_STATUS: ReadonlySet<number> = new Set([429, 500, 502, 503, 504]);

export interface TransportRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  /** Operation name for logs and metrics, for example "capture". */
  op: string;
  /** Sent as PayPal-Request-Id on every attempt. */
  requestId?: string;
  auctionId?: string;
  holdId?: string;
}

export interface TransportResult {
  status: number;
  headers: HeaderBag;
  text: string;
  /** Number of attempts made, 1 when the first try was final. */
  attempts: number;
}

/**
 * Parses a Retry-After value (delta-seconds or HTTP date) into milliseconds from
 * now. Returns undefined when absent or unparseable. Negative or past values are 0.
 */
export function parseRetryAfter(value: string | undefined, nowMs: number): number | undefined {
  if (value === undefined) return undefined;
  const v = value.trim();
  if (v === '') return undefined;
  if (/^\d+$/.test(v)) {
    const seconds = Number(v);
    return Number.isSafeInteger(seconds) ? seconds * 1000 : undefined;
  }
  // HTTP dates contain a month name; this rejects numbers Date.parse would read as a year.
  if (!/[A-Za-z]/.test(v)) return undefined;
  const at = Date.parse(v);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, at - nowMs);
}

function headerOf(headers: HeaderBag, name: string): string | undefined {
  if (typeof (headers as { get?: unknown }).get === 'function') {
    const v = (headers as { get(n: string): string | null }).get(name);
    return v === null ? undefined : v;
  }
  const bag = headers as Readonly<Record<string, string | readonly string[] | undefined>>;
  const lower = name.toLowerCase();
  for (const key of Object.keys(bag)) {
    if (key.toLowerCase() !== lower) continue;
    const v = bag[key];
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return typeof v[0] === 'string' ? v[0] : undefined;
  }
  return undefined;
}

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class Transport {
  private readonly doFetch: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly metrics: PaymentsMetrics | undefined;
  private readonly baseMs: number;
  private readonly capMs: number;
  private readonly maxAttempts: number;
  private readonly retryAfterMaxMs: number;

  constructor(opts: TransportOptions = {}) {
    this.doFetch = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.sleep = opts.sleep ?? realSleep;
    this.random = opts.random ?? Math.random;
    this.now = opts.now ?? Date.now;
    this.metrics = opts.metrics;
    this.baseMs = opts.baseMs ?? DEFAULT_BASE_MS;
    this.capMs = opts.capMs ?? DEFAULT_CAP_MS;
    this.maxAttempts = Math.max(1, opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
    this.retryAfterMaxMs = opts.retryAfterMaxMs ?? RETRY_AFTER_MAX_MS;
  }

  /** Full-jitter delay before retry number `retries` (0 for the first retry). */
  backoffMs(retries: number): number {
    const ceiling = Math.min(this.capMs, this.baseMs * 2 ** retries);
    return Math.floor(this.random() * ceiling);
  }

  private delayFor(retries: number, retryAfterHeader: string | undefined): number {
    const computed = this.backoffMs(retries);
    const hinted = parseRetryAfter(retryAfterHeader, this.now());
    if (hinted === undefined) return computed;
    return Math.max(computed, Math.min(hinted, this.retryAfterMaxMs));
  }

  async send(req: TransportRequest): Promise<TransportResult> {
    const headers: Record<string, string> = { ...(req.headers ?? {}) };
    if (req.requestId !== undefined) headers[REQUEST_ID_HEADER] = req.requestId;
    const init: TransportInit = { method: req.method, headers };
    if (req.body !== undefined) init.body = req.body;

    let lastError: PayPalError | undefined;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const startedAt = this.now();
      let retryAfter: string | undefined;
      let result: TransportResult | undefined;
      let failure: PayPalError | undefined;

      try {
        const res = await this.doFetch(req.url, init);
        const text = await res.text();
        if (!RETRYABLE_STATUS.has(res.status)) {
          result = { status: res.status, headers: res.headers, text, attempts: attempt };
        } else {
          retryAfter = headerOf(res.headers, 'retry-after');
          failure = classifyError(res.status, res.headers, text);
        }
      } catch (cause) {
        failure = classifyNetworkError(cause, req.method);
      }

      this.report(req, attempt, startedAt, result, failure);
      if (result !== undefined) return result;

      lastError = failure;
      if (attempt >= this.maxAttempts) break;
      this.metrics?.incr('paypal_retries_total', { op: req.op });
      await this.sleep(this.delayFor(attempt - 1, retryAfter));
    }
    if (lastError === undefined) throw new Error('transport: no attempt was made');
    throw lastError;
  }

  /** One log line per attempt (R-PAY-019, R-PAY-130) plus the call counter. */
  private report(
    req: TransportRequest,
    attempt: number,
    startedAt: number,
    result: TransportResult | undefined,
    failure: PayPalError | undefined,
  ): void {
    const latencyMs = Math.max(0, this.now() - startedAt);
    const outcome = result !== undefined ? 'ok' : (failure?.outcome ?? 'unknown');
    const event: Parameters<typeof logPayment>[0] = {
      level: result !== undefined ? 'info' : 'warn',
      op: req.op,
      attempt,
      status: result?.status ?? failure?.status ?? 0,
      latencyMs,
      outcome,
    };
    if (req.requestId !== undefined) event.requestId = req.requestId;
    if (req.auctionId !== undefined) event.auctionId = req.auctionId;
    if (req.holdId !== undefined) event.holdId = req.holdId;
    if (result === undefined) {
      if (failure !== undefined) {
        event.kind = failure.kind;
        if (failure.debugId !== undefined) event.debugId = failure.debugId;
      }
    } else {
      const debugId = headerOf(result.headers, 'paypal-debug-id');
      if (debugId !== undefined) event.debugId = debugId;
    }
    logPayment(event);
    this.metrics?.incr('paypal_calls_total', { op: req.op, outcome });
    this.metrics?.observe('paypal_latency_ms', latencyMs, { op: req.op });
  }
}
