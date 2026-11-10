/** Latency summary in milliseconds. Percentiles use the nearest-rank rule over recent samples. */
export interface HistogramSnapshot {
  count: number;
  p50: number;
  p95: number;
  p99: number;
}

const WINDOW = 2048;

export class Histogram {
  private readonly samples: number[] = [];
  private next = 0;
  private total = 0;

  observe(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    if (this.samples.length < WINDOW) this.samples.push(ms);
    else this.samples[this.next] = ms;
    this.next = (this.next + 1) % WINDOW;
    this.total += 1;
  }

  snapshot(): HistogramSnapshot {
    const sorted = [...this.samples].sort((a, b) => a - b);
    const at = (p: number): number => {
      if (sorted.length === 0) return 0;
      const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
      return sorted[rank - 1] ?? 0;
    };
    return { count: this.total, p50: at(50), p95: at(95), p99: at(99) };
  }
}

/** PayPal gateway operations that are timed and counted (R-QA-047). */
export type PaypalOp =
  | 'createOrder'
  | 'getOrder'
  | 'authorizeOrder'
  | 'getHoldTruth'
  | 'capture'
  | 'voidAuthorization'
  | 'reauthorize';

const MAX_REASONS = 32;
const REASON = /^[a-z0-9_]{1,40}$/;

export type WebhookOutcome = 'ok' | 'duplicate' | 'invalid_signature' | 'retry' | 'too_large';

/** Live values read when a snapshot is taken. */
export interface MetricGauges {
  connections(): number;
  rooms(): number;
  mailboxDepth(): number;
}

export interface MetricsSnapshot {
  connections: number;
  rooms: number;
  bids: { accepted: number; rejected: number };
  /** Rejected bids by reason code; codes that are not plain snake_case count as `other`. */
  bidRejectedByReason: Record<string, number>;
  /** PayPal gateway calls by `<operation>.<ok|error>`. */
  paypalCalls: Record<string, number>;
  paypalLatencyMs: HistogramSnapshot;
  mailboxDepth: number;
  bidLatencyMs: HistogramSnapshot;
  storeAppendMs: HistogramSnapshot;
  webhookOutcomes: Record<WebhookOutcome, number>;
  rateLimitHits: number;
  /** Tokens that verified only under TOKEN_SECRET_PREVIOUS. */
  previousSecretUses: number;
}

/** In-process counters and histograms behind `GET /metrics` (R-RT-135). No labels, no personal data. */
export class MetricsCollector {
  private accepted = 0;
  private rejected = 0;
  private rateLimited = 0;
  private previousUses = 0;
  private readonly bidLatency = new Histogram();
  private readonly storeAppend = new Histogram();
  private readonly paypalLatency = new Histogram();
  private readonly rejectedReasons = new Map<string, number>();
  private readonly paypal = new Map<string, number>();
  private readonly webhooks: Record<WebhookOutcome, number> = {
    ok: 0,
    duplicate: 0,
    invalid_signature: 0,
    retry: 0,
    too_large: 0,
  };

  constructor(private readonly gauges: MetricGauges) {}

  bidAccepted(): void {
    this.accepted += 1;
  }
  bidRejected(reason?: string): void {
    this.rejected += 1;
    let key = reason !== undefined && REASON.test(reason) ? reason : 'other';
    if (!this.rejectedReasons.has(key) && this.rejectedReasons.size >= MAX_REASONS) key = 'other';
    this.rejectedReasons.set(key, (this.rejectedReasons.get(key) ?? 0) + 1);
  }
  /** One PayPal gateway call: its operation, whether it returned, and how long it took. */
  paypalCall(op: PaypalOp, ok: boolean, ms: number): void {
    const key = `${op}.${ok ? 'ok' : 'error'}`;
    this.paypal.set(key, (this.paypal.get(key) ?? 0) + 1);
    this.paypalLatency.observe(ms);
  }
  rateLimitHit(): void {
    this.rateLimited += 1;
  }
  previousSecretUse(): void {
    this.previousUses += 1;
  }
  bidLatencyMs(ms: number): void {
    this.bidLatency.observe(ms);
  }
  storeAppendMs(ms: number): void {
    this.storeAppend.observe(ms);
  }
  webhookOutcome(outcome: WebhookOutcome): void {
    this.webhooks[outcome] += 1;
  }

  snapshot(): MetricsSnapshot {
    return {
      connections: this.gauges.connections(),
      rooms: this.gauges.rooms(),
      bids: { accepted: this.accepted, rejected: this.rejected },
      bidRejectedByReason: Object.fromEntries(this.rejectedReasons),
      paypalCalls: Object.fromEntries(this.paypal),
      paypalLatencyMs: this.paypalLatency.snapshot(),
      mailboxDepth: this.gauges.mailboxDepth(),
      bidLatencyMs: this.bidLatency.snapshot(),
      storeAppendMs: this.storeAppend.snapshot(),
      webhookOutcomes: { ...this.webhooks },
      rateLimitHits: this.rateLimited,
      previousSecretUses: this.previousUses,
    };
  }
}
