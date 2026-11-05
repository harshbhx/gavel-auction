import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { METRICS_MAX_PER_WINDOW, METRICS_WINDOW_MS, createMetricsRoute } from '../src/http/metrics';
import { Histogram, MetricsCollector, type MetricsSnapshot } from '../src/ops/metrics';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

const KEY = 'test-admin-key-placeholder-0000';
const admin = { 'x-admin-key': KEY };

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

    const server = createServer(
      (req, res) => void createMetricsRoute(collector, { adminKey: KEY })(req, res),
    );
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = 'http://127.0.0.1:' + String((server.address() as AddressInfo).port);

    expect((await fetch(base + '/metrics')).status).toBe(401);
    expect((await fetch(base + '/metrics', { headers: { 'x-admin-key': 'wrong' } })).status).toBe(
      401,
    );
    const res = await fetch(base + '/metrics', { headers: admin });
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

    expect((await fetch(base + '/metrics', { method: 'POST', headers: admin })).status).toBe(405);
  });

  it('answers 429 once the per-window cap is passed and recovers after the window', async () => {
    const collector = new MetricsCollector({
      connections: () => 0,
      rooms: () => 0,
      mailboxDepth: () => 0,
    });
    let t = 1_000;
    const route = createMetricsRoute(collector, { adminKey: KEY, now: () => t });
    const server = createServer((req, res) => void route(req, res));
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = 'http://127.0.0.1:' + String((server.address() as AddressInfo).port);
    for (let i = 0; i < METRICS_MAX_PER_WINDOW; i++) {
      expect((await fetch(base + '/metrics', { headers: admin })).status).toBe(200);
    }
    const limited = await fetch(base + '/metrics', { headers: admin });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).not.toBeNull();
    t += METRICS_WINDOW_MS;
    expect((await fetch(base + '/metrics', { headers: admin })).status).toBe(200);
  });

  it('unauthenticated requests do not consume the operator budget (R7S-04)', async () => {
    const collector = new MetricsCollector({
      connections: () => 0,
      rooms: () => 0,
      mailboxDepth: () => 0,
    });
    const route = createMetricsRoute(collector, { adminKey: KEY, now: () => 1_000 });
    const server = createServer((req, res) => void route(req, res));
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = 'http://127.0.0.1:' + String((server.address() as AddressInfo).port);
    for (let i = 0; i < METRICS_MAX_PER_WINDOW + 5; i++) {
      expect((await fetch(base + '/metrics')).status).toBe(401);
    }
    expect((await fetch(base + '/metrics', { headers: admin })).status).toBe(200);
  });
});
