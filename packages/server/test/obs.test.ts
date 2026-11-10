import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ManualClock } from '@gavel/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createLogger } from '../src/log/logger';
import { createLogRing, maskEmails, OPS_LOG_LINES } from '../src/obs/logring';
import { createOpsSummaryRoute, createPrometheusRoute } from '../src/obs/ops-summary';
import { formatPrometheus } from '../src/obs/prometheus';
import { MetricsCollector } from '../src/ops/metrics';
import { meteredGateway } from '../src/obs/metered-gateway';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

function collector(): MetricsCollector {
  const m = new MetricsCollector({ connections: () => 3, rooms: () => 1, mailboxDepth: () => 0 });
  m.bidAccepted();
  m.bidRejected();
  m.bidLatencyMs(12);
  m.webhookOutcome('duplicate');
  return m;
}

describe('log ring', () => {
  it('keeps the newest 100 lines and masks emails', () => {
    const ring = createLogRing();
    for (let i = 0; i < OPS_LOG_LINES + 5; i += 1) ring.write(`line ${String(i)}`);
    const lines = ring.lines();
    expect(lines).toHaveLength(OPS_LOG_LINES);
    expect(lines[0]).toBe('line 5');
    expect(maskEmails('mail alice@example.com now')).toBe('mail a***@e***.com now');
  });

  it('every logger line parses with the required keys and holds no full email', () => {
    const ring = createLogRing();
    const log = createLogger({ clock: new ManualClock(), sink: ring.write });
    log.info('registered bidder@example.org', { reqId: 'r1', auctionId: 'a1' });
    for (const line of ring.lines()) {
      const rec = JSON.parse(line) as Record<string, unknown>;
      for (const key of ['ts', 'level', 'msg', 'context']) expect(rec).toHaveProperty(key);
      expect(line).not.toMatch(/bidder@example\.org/);
    }
  });
});

describe('prometheus text', () => {
  it('lists the metric families', () => {
    const text = formatPrometheus(collector().snapshot());
    for (const name of [
      'gavel_ws_connections 3',
      'gavel_bids_total{result="accepted"} 1',
      'gavel_bids_total{result="rejected"} 1',
      'gavel_bid_ack_latency_ms{quantile="0.95"} 12',
      'gavel_webhook_total{outcome="duplicate"} 1',
    ]) {
      expect(text).toContain(name);
    }
    expect(text.endsWith('\n')).toBe(true);
  });
});

describe('R-QA-047 metric families', () => {
  it('exposes bid reasons, PayPal calls, saga transitions and webhook counts', () => {
    const m = collector();
    m.bidRejected('below_min');
    m.bidRejected('Not A Code');
    m.paypalCall('capture', true, 40);
    m.paypalCall('capture', false, 80);
    const text = formatPrometheus(m.snapshot(), [
      { auctionId: 'a1', lotId: 'a1', state: 'SETTLED', transitions: { HOLDING: 1, SETTLED: 1 } },
      { auctionId: 'a2', lotId: 'a2', state: 'HOLDING', transitions: { HOLDING: 1 } },
    ]);
    for (const line of [
      'gavel_bids_rejected_total{reason="below_min"} 1',
      'gavel_bids_rejected_total{reason="other"} 1',
      'gavel_paypal_calls_total{op="capture",status="ok"} 1',
      'gavel_paypal_calls_total{op="capture",status="error"} 1',
      'gavel_paypal_latency_ms_count 2',
      'gavel_saga_transitions_total{state="HOLDING"} 2',
      'gavel_saga_transitions_total{state="SETTLED"} 1',
      'gavel_saga_lots{state="SETTLED"} 1',
      'gavel_saga_lots{state="HOLDING"} 1',
      'gavel_webhook_total{outcome="duplicate"} 1',
      'gavel_webhook_total{outcome="ok"} 0',
      'gavel_ws_connections 3',
    ]) {
      expect(text).toContain(line);
    }
  });

  it('counts gateway calls by outcome without touching arguments or results', async () => {
    const m = collector();
    let t = 0;
    const gw = meteredGateway(
      {
        voidAuthorization: () => Promise.reject(new Error('boom')),
        getOrder: () => Promise.resolve({ orderId: 'o', status: 'APPROVED' }),
      } as never,
      m,
      () => (t += 10),
    );
    await expect(gw.voidAuthorization('auth', 'req')).rejects.toThrow('boom');
    await gw.getOrder('o');
    const snap = m.snapshot();
    expect(snap.paypalCalls).toEqual({ 'voidAuthorization.error': 1, 'getOrder.ok': 1 });
    expect(snap.paypalLatencyMs.count).toBe(2);
  });

  it('caps the number of reason labels', () => {
    const m = collector();
    for (let i = 0; i < 100; i += 1) m.bidRejected(`r_${String(i)}`);
    expect(Object.keys(m.snapshot().bidRejectedByReason).length).toBeLessThanOrEqual(33);
  });
});

describe('ops routes', () => {
  it('require the admin key and serve the summary and Prometheus text', async () => {
    const m = collector();
    const ring = createLogRing();
    ring.write('{"msg":"hello"}');
    const summary = createOpsSummaryRoute({
      adminKey: 'k-test',
      logs: () => ring.lines(),
      sagas: () => [{ auctionId: 'a1', lotId: 'l1', state: 'HOLD_PLACED' }],
      metrics: () => m.snapshot(),
    });
    const prom = createPrometheusRoute({ adminKey: 'k-test', metrics: () => m.snapshot() });
    const server = createServer((req, res) =>
      req.url === '/ops/summary' ? summary(req, res) : prom(req, res),
    );
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = 'http://127.0.0.1:' + String((server.address() as AddressInfo).port);
    const headers = { 'x-admin-key': 'k-test' };

    expect((await fetch(base + '/ops/summary')).status).toBe(401);
    expect((await fetch(base + '/metrics/prometheus')).status).toBe(401);
    const res = await fetch(base + '/ops/summary', { headers });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { logs: string[]; sagas: unknown[]; paypal: object };
    expect(body.logs).toHaveLength(1);
    expect(body.sagas).toHaveLength(1);
    expect(body.paypal).toMatchObject({ duplicate: 1 });
    const p = await fetch(base + '/metrics/prometheus', { headers });
    expect(p.headers.get('content-type')).toContain('text/plain');
    expect(await p.text()).toContain('gavel_rooms_loaded 1');
  });
});
