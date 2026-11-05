import type { IncomingMessage, ServerResponse } from 'node:http';
import type { MetricsCollector } from '../ops/metrics';
import { adminKeyMatches } from './ops';

/** At most this many requests per window are answered; the rest get 429. */
export const METRICS_MAX_PER_WINDOW = 60;
export const METRICS_WINDOW_MS = 60_000;

export interface MetricsRouteDeps {
  /** Operator key from `x-admin-key`; the route is closed without a match (R-RT-137). */
  adminKey: string;
  now?: () => number;
}

function sendJson(res: ServerResponse, status: number, body: string): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(body);
}

/** `GET /metrics`: the collector's snapshot as JSON; admin key required and rate limited (R-RT-135). */
export function createMetricsRoute(
  collector: Pick<MetricsCollector, 'snapshot'>,
  deps: MetricsRouteDeps,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const now = deps.now ?? Date.now;
  let windowStart = now();
  let count = 0;
  return (req, res) => {
    if (req.method !== 'GET') {
      res.setHeader('allow', 'GET');
      sendJson(res, 405, '{"error":"method_not_allowed"}');
      return Promise.resolve();
    }
    if (!adminKeyMatches(req, deps.adminKey)) {
      sendJson(res, 401, '{"error":"unauthorized"}');
      return Promise.resolve();
    }
    const t = now();
    if (t - windowStart >= METRICS_WINDOW_MS) {
      windowStart = t;
      count = 0;
    }
    count += 1;
    if (count > METRICS_MAX_PER_WINDOW) {
      const wait = Math.max(1, Math.ceil((windowStart + METRICS_WINDOW_MS - t) / 1000));
      res.setHeader('retry-after', String(wait));
      sendJson(res, 429, '{"error":"rate_limited"}');
      return Promise.resolve();
    }
    sendJson(res, 200, JSON.stringify(collector.snapshot()));
    return Promise.resolve();
  };
}
