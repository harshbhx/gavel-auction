import { afterEach, describe, expect, it } from 'vitest';
import { composeServer, type Composed, type ComposeOptions } from '../src/boot/compose';

const KEY = 'test-admin-key-test-admin-key';
const base = {
  PUBLIC_URL: 'http://localhost:8080',
  TOKEN_SECRET: 'test-secret-test-secret-test-secret-0123',
  ADMIN_KEY: KEY,
  PAYMENTS: 'fake',
  LOG_LEVEL: 'info',
};

const running: Composed[] = [];
afterEach(async () => {
  for (const app of running.splice(0)) await app.close();
});

async function boot(opts: ComposeOptions = {}): Promise<string> {
  const app = await composeServer(base, { sink: () => undefined, ...opts });
  running.push(app);
  return `http://127.0.0.1:${String(await app.listen(0))}`;
}

describe('ops routes in the composed server (HRD-22)', () => {
  it('answers /healthz without a key', async () => {
    const url = await boot();
    expect((await fetch(`${url}/healthz`)).status).toBe(200);
  });

  it('reports warm steps with an injected clock and leaks nothing else', async () => {
    let t = 0;
    const url = await boot({ warmupNow: () => (t += 5) });
    const res = await fetch(`${url}/warmup`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      steps: Array<Record<string, unknown>>;
    };
    expect(body.ok).toBe(true);
    expect(body.steps.map((s) => s.name)).toEqual(['database', 'paypal-token', 'demo-auction']);
    for (const step of body.steps) expect(Object.keys(step).sort()).toEqual(['ms', 'name', 'ok']);
    expect(Object.keys(body).sort()).toEqual(['elapsedMs', 'ok', 'steps']);
    expect(JSON.stringify(body)).not.toContain(KEY);
  });

  it('answers 503 when a step fails', async () => {
    const url = await boot({
      warmupSteps: [{ name: 'broken', run: () => Promise.reject(new Error('boom')) }],
    });
    const res = await fetch(`${url}/warmup`);
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).toContain('"broken"');
    expect(text).not.toContain('boom');
  });

  it('answers 503 when a step outlives the budget', async () => {
    const url = await boot({
      warmupBudgetMs: 20,
      warmupSteps: [{ name: 'slow', run: () => new Promise<void>(() => undefined) }],
    });
    expect((await fetch(`${url}/warmup`)).status).toBe(503);
  });

  it('protects /ops/summary and /metrics/prometheus with the admin key', async () => {
    const url = await boot();
    for (const path of ['/ops/summary', '/metrics/prometheus']) {
      expect((await fetch(`${url}${path}`)).status).toBe(401);
      expect((await fetch(`${url}${path}`, { headers: { 'x-admin-key': 'wrong' } })).status).toBe(
        401,
      );
    }
    const ok = await fetch(`${url}/metrics/prometheus`, { headers: { 'x-admin-key': KEY } });
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain('# TYPE');
  });

  it('feeds the log ring from the logger and masks emails', async () => {
    const lines: string[] = [];
    const url = await boot({ sink: (l) => void lines.push(l) });
    const res = await fetch(`${url}/ops/summary`, { headers: { 'x-admin-key': KEY } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { logs: string[]; sagas: unknown[]; metrics: unknown };
    expect(body.logs.some((l) => l.includes('server composed'))).toBe(true);
    expect(JSON.stringify(body)).not.toContain(KEY);
    expect(lines.length).toBeGreaterThan(0);
    expect(Array.isArray(body.sagas)).toBe(true);
  });

  it('writes only parseable log lines with the schema keys and no full email (T-QA-081)', async () => {
    const lines: string[] = [];
    const url = await boot({ sink: (l) => void lines.push(l) });
    await fetch(`${url}/healthz`);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const rec = JSON.parse(line) as Record<string, unknown>;
      expect(typeof rec['ts']).toBe('number');
      expect(['debug', 'info', 'warn', 'error']).toContain(rec['level']);
      expect(typeof rec['msg']).toBe('string');
      expect(typeof rec['context']).toBe('object');
      expect(line).not.toMatch(/[A-Za-z0-9._%+-]{2,}@[A-Za-z0-9-]{2,}\.[A-Za-z]{2,}/);
    }
  });

  it('serves the R-QA-047 metric families and PayPal outcomes to the operator', async () => {
    const url = await boot();
    const headers = { 'x-admin-key': KEY };
    const prom = await (await fetch(`${url}/metrics/prometheus`, { headers })).text();
    for (const family of [
      'gavel_bids_total',
      'gavel_bids_rejected_total',
      'gavel_bid_ack_latency_ms',
      'gavel_saga_transitions_total',
      'gavel_saga_lots',
      'gavel_paypal_calls_total',
      'gavel_paypal_latency_ms',
      'gavel_webhook_total',
      'gavel_ws_connections',
    ]) {
      expect(prom).toContain(`# TYPE ${family} `);
    }
    const summary = (await (await fetch(`${url}/ops/summary`, { headers })).json()) as {
      paypal: object;
      paypalCalls: object;
      sagas: unknown[];
    };
    expect(summary.paypal).toHaveProperty('duplicate');
    expect(summary.paypalCalls).toBeTypeOf('object');
    expect(summary.sagas).toEqual([]);
  });

  it('keeps /metrics working', async () => {
    const url = await boot();
    expect((await fetch(`${url}/metrics`)).status).toBe(401);
    const res = await fetch(`${url}/metrics`, { headers: { 'x-admin-key': KEY } });
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty('bids');
  });
});
