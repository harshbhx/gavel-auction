import type { IncomingMessage, ServerResponse } from 'node:http';
import type { MetricsCollector } from '../ops/metrics';

/** `GET /metrics`: the collector's snapshot as JSON (R-RT-135). */
export function createMetricsRoute(
  collector: Pick<MetricsCollector, 'snapshot'>,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return (req, res) => {
    if (req.method !== 'GET') {
      res.statusCode = 405;
      res.setHeader('allow', 'GET');
      res.end();
      return Promise.resolve();
    }
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(collector.snapshot()));
    return Promise.resolve();
  };
}
