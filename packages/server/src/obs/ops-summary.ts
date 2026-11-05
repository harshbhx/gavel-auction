import type { IncomingMessage, ServerResponse } from 'node:http';
import { adminKeyMatches } from '../http/ops';
import type { MetricsSnapshot } from '../ops/metrics';
import { formatPrometheus, PROMETHEUS_CONTENT_TYPE } from './prometheus';

/** Saga state of one lot, as the ops view lists it. */
export interface OpsSagaRow {
  auctionId: string;
  lotId: string;
  state: string;
}

export interface OpsSummary {
  logs: string[];
  sagas: OpsSagaRow[];
  /** PayPal call outcomes: webhook intake counts by outcome. */
  paypal: Record<string, number>;
  metrics: MetricsSnapshot;
}

export interface OpsSummaryDeps {
  adminKey: string;
  logs(): string[];
  sagas(): OpsSagaRow[];
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

export function buildOpsSummary(deps: Omit<OpsSummaryDeps, 'adminKey'>): OpsSummary {
  const metrics = deps.metrics();
  return {
    logs: deps.logs(),
    sagas: deps.sagas(),
    paypal: { ...metrics.webhookOutcomes },
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
    send(res, 200, 'application/json', JSON.stringify(buildOpsSummary(deps)));
  };
}

/** `GET /metrics/prometheus`: same data as `/metrics` in Prometheus text; operator key required. */
export function createPrometheusRoute(deps: {
  adminKey: string;
  metrics(): MetricsSnapshot;
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
    send(res, 200, PROMETHEUS_CONTENT_TYPE, formatPrometheus(deps.metrics()));
  };
}
