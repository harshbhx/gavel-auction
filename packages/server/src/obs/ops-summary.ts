import type { IncomingMessage, ServerResponse } from 'node:http';
import { adminKeyMatches } from '../http/ops';
import type { MetricsSnapshot } from '../ops/metrics';
import { formatPrometheus, PROMETHEUS_CONTENT_TYPE } from './prometheus';

/** Saga state of one lot, as the ops view lists it. */
export interface OpsSagaRow {
  auctionId: string;
  lotId: string;
  state: string;
  /** Count of saga transitions into each state, from the journal history. */
  transitions?: Record<string, number>;
}

export interface OpsSummary {
  logs: string[];
  sagas: OpsSagaRow[];
  /** PayPal call outcomes: webhook intake counts by outcome. */
  paypal: Record<string, number>;
  /** PayPal gateway calls by `<operation>.<ok|error>`, with latency in `metrics`. */
  paypalCalls: Record<string, number>;
  metrics: MetricsSnapshot;
}

export interface OpsSummaryDeps {
  adminKey: string;
  logs(): string[];
  sagas(): OpsSagaRow[] | Promise<OpsSagaRow[]>;
  metrics(): MetricsSnapshot;
}

function send(res: ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, {
    'content-type': type,
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

export async function buildOpsSummary(deps: Omit<OpsSummaryDeps, 'adminKey'>): Promise<OpsSummary> {
  const metrics = deps.metrics();
  return {
    logs: deps.logs(),
    sagas: await deps.sagas(),
    paypal: { ...metrics.webhookOutcomes },
    paypalCalls: { ...metrics.paypalCalls },
    metrics,
  };
}

/** `GET /ops/summary`: operator key required; JSON for the ops page. */
export function createOpsSummaryRoute(
  deps: OpsSummaryDeps,
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    if (req.method !== 'GET') {
      res.setHeader('allow', 'GET');
      send(res, 405, 'application/json', '{"error":"method_not_allowed"}');
      return;
    }
    if (!adminKeyMatches(req, deps.adminKey)) {
      send(res, 401, 'application/json', '{"error":"unauthorized"}');
      return;
    }
    buildOpsSummary(deps).then(
      (summary) => send(res, 200, 'application/json', JSON.stringify(summary)),
      () => send(res, 500, 'application/json', '{"error":"internal"}'),
    );
  };
}

/** `GET /metrics/prometheus`: same data as `/metrics` in Prometheus text; operator key required. */
export function createPrometheusRoute(deps: {
  adminKey: string;
  metrics(): MetricsSnapshot;
  sagas?(): OpsSagaRow[] | Promise<OpsSagaRow[]>;
}): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    if (req.method !== 'GET') {
      res.setHeader('allow', 'GET');
      send(res, 405, 'application/json', '{"error":"method_not_allowed"}');
      return;
    }
    if (!adminKeyMatches(req, deps.adminKey)) {
      send(res, 401, 'application/json', '{"error":"unauthorized"}');
      return;
    }
    Promise.resolve(deps.sagas?.() ?? []).then(
      (sagas) => send(res, 200, PROMETHEUS_CONTENT_TYPE, formatPrometheus(deps.metrics(), sagas)),
      () => send(res, 500, 'application/json', '{"error":"internal"}'),
    );
  };
}
