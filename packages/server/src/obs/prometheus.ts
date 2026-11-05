import type { HistogramSnapshot, MetricsSnapshot } from '../ops/metrics';

/** Content type of the Prometheus text exposition format. */
export const PROMETHEUS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

function gauge(out: string[], name: string, help: string, value: number): void {
  out.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`, `${name} ${String(value)}`);
}

function counter(
  out: string[],
  name: string,
  help: string,
  rows: ReadonlyArray<readonly [string, number]>,
): void {
  out.push(`# HELP ${name} ${help}`, `# TYPE ${name} counter`);
  for (const [labels, value] of rows) {
    out.push(`${name}${labels === '' ? '' : `{${labels}}`} ${String(value)}`);
  }
}

function summary(out: string[], name: string, help: string, h: HistogramSnapshot): void {
  out.push(`# HELP ${name} ${help}`, `# TYPE ${name} summary`);
  out.push(`${name}{quantile="0.5"} ${String(h.p50)}`);
  out.push(`${name}{quantile="0.95"} ${String(h.p95)}`);
  out.push(`${name}{quantile="0.99"} ${String(h.p99)}`);
  out.push(`${name}_count ${String(h.count)}`);
}

/** Renders the collector snapshot as Prometheus text. Labels are fixed names, never user data. */
export function formatPrometheus(s: MetricsSnapshot): string {
  const out: string[] = [];
  gauge(out, 'gavel_ws_connections', 'Open websocket connections.', s.connections);
  gauge(out, 'gavel_rooms_loaded', 'Rooms loaded in the host.', s.rooms);
  gauge(out, 'gavel_mailbox_depth', 'Commands queued across rooms.', s.mailboxDepth);
  counter(out, 'gavel_bids_total', 'Bids by result.', [
    ['result="accepted"', s.bids.accepted],
    ['result="rejected"', s.bids.rejected],
  ]);
  summary(out, 'gavel_bid_ack_latency_ms', 'Bid acknowledgement latency.', s.bidLatencyMs);
  summary(out, 'gavel_store_append_ms', 'Store append latency.', s.storeAppendMs);
  counter(
    out,
    'gavel_webhook_total',
    'Webhook intake by outcome.',
    Object.entries(s.webhookOutcomes).map(([k, v]) => [`outcome="${k}"`, v] as const),
  );
  counter(out, 'gavel_rate_limit_hits_total', 'Requests refused by a limiter.', [
    ['', s.rateLimitHits],
  ]);
  counter(out, 'gavel_previous_secret_uses_total', 'Tokens verified with the previous secret.', [
    ['', s.previousSecretUses],
  ]);
  return out.join('\n') + '\n';
}
