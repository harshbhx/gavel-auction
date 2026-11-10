import type { HistogramSnapshot, MetricsSnapshot } from '../ops/metrics';
import type { OpsSagaRow } from './ops-summary';

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
export function formatPrometheus(s: MetricsSnapshot, sagas: readonly OpsSagaRow[] = []): string {
  const out: string[] = [];
  gauge(out, 'gavel_ws_connections', 'Open websocket connections.', s.connections);
  gauge(out, 'gavel_rooms_loaded', 'Rooms loaded in the host.', s.rooms);
  gauge(out, 'gavel_mailbox_depth', 'Commands queued across rooms.', s.mailboxDepth);
  counter(out, 'gavel_bids_total', 'Bids by result.', [
    ['result="accepted"', s.bids.accepted],
    ['result="rejected"', s.bids.rejected],
  ]);
  counter(
    out,
    'gavel_bids_rejected_total',
    'Rejected bids by reason.',
    Object.entries(s.bidRejectedByReason).map(([k, v]) => [`reason="${k}"`, v] as const),
  );
  summary(out, 'gavel_bid_ack_latency_ms', 'Bid acknowledgement latency.', s.bidLatencyMs);
  summary(out, 'gavel_store_append_ms', 'Store append latency.', s.storeAppendMs);
  counter(
    out,
    'gavel_webhook_total',
    'Webhook intake by outcome.',
    Object.entries(s.webhookOutcomes).map(([k, v]) => [`outcome="${k}"`, v] as const),
  );
  counter(
    out,
    'gavel_paypal_calls_total',
    'PayPal gateway calls by operation and status.',
    Object.entries(s.paypalCalls).map(([k, v]) => {
      const dot = k.lastIndexOf('.');
      return [`op="${k.slice(0, dot)}",status="${k.slice(dot + 1)}"`, v] as const;
    }),
  );
  summary(out, 'gavel_paypal_latency_ms', 'PayPal gateway call latency.', s.paypalLatencyMs);
  const transitions: Record<string, number> = {};
  const lots: Record<string, number> = {};
  for (const row of sagas) {
    lots[row.state] = (lots[row.state] ?? 0) + 1;
    for (const [state, n] of Object.entries(row.transitions ?? {})) {
      transitions[state] = (transitions[state] ?? 0) + n;
    }
  }
  counter(
    out,
    'gavel_saga_transitions_total',
    'Settlement saga transitions by the state entered.',
    Object.entries(transitions).map(([k, v]) => [`state="${k}"`, v] as const),
  );
  out.push(
    '# HELP gavel_saga_lots Lots by current settlement saga state.',
    '# TYPE gavel_saga_lots gauge',
  );
  for (const [state, n] of Object.entries(lots))
    out.push(`gavel_saga_lots{state="${state}"} ${String(n)}`);
  counter(out, 'gavel_rate_limit_hits_total', 'Requests refused by a limiter.', [
    ['', s.rateLimitHits],
  ]);
  counter(out, 'gavel_previous_secret_uses_total', 'Tokens verified with the previous secret.', [
    ['', s.previousSecretUses],
  ]);
  return out.join('\n') + '\n';
}
