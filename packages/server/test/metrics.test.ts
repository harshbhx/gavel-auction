import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createMetricsRoute } from '../src/http/metrics';
import { Histogram, MetricsCollector, type MetricsSnapshot } from '../src/ops/metrics';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

describe('metrics', () => {
  it('computes nearest-rank percentiles', () => {
    const h = new Histogram();
    for (let i = 1; i <= 100; i++) h.observe(i);
    expect(h.snapshot()).toEqual({ count: 100, p50: 50, p95: 95, p99: 99 });
    expect(new Histogram().snapshot()).toEqual({ count: 0, p50: 0, p95: 0, p99: 0 });
  });

  it('after N bids /metrics counters equal N and histograms are populated (T-RT-094)', async () => {
    const N = 25;
    const collector = new MetricsCollector({
      connections: () => 3,
      rooms: () => 1,
      mailboxDepth: () => 0,
    });
    for (let i = 0; i < N; i++) {
      collector.bidAccepted();
      collector.bidLatencyMs(i + 1);
      collector.storeAppendMs(2);
    }
    collector.bidRejected();
    collector.rateLimitHit();
    collector.webhookOutcome('ok');
    collector.webhookOutcome('retry');

    const server = createServer((req, res) => void createMetricsRoute(collector)(req, res));
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = 'http://127.0.0.1:' + String((server.address() as AddressInfo).port);

    const res = await fetch(base + '/metrics');
    expect(res.status).toBe(200);
    const m = (await res.json()) as MetricsSnapshot;
    expect(m.bids).toEqual({ accepted: N, rejected: 1 });
    expect(m.bidLatencyMs.count).toBe(N);
    expect(m.bidLatencyMs.p50).toBeGreaterThan(0);
    expect(m.bidLatencyMs.p99).toBeGreaterThanOrEqual(m.bidLatencyMs.p95);
    expect(m.storeAppendMs.count).toBe(N);
    expect(m.connections).toBe(3);
    expect(m.rooms).toBe(1);
    expect(m.rateLimitHits).toBe(1);
    expect(m.webhookOutcomes.ok).toBe(1);
    expect(m.webhookOutcomes.retry).toBe(1);

    expect((await fetch(base + '/metrics', { method: 'POST' })).status).toBe(405);
  });
});
