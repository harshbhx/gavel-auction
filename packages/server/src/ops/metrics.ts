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
  bidRejected(): void {
    this.rejected += 1;
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
      mailboxDepth: this.gauges.mailboxDepth(),
      bidLatencyMs: this.bidLatency.snapshot(),
      storeAppendMs: this.storeAppend.snapshot(),
      webhookOutcomes: { ...this.webhooks },
      rateLimitHits: this.rateLimited,
      previousSecretUses: this.previousUses,
    };
  }
}
