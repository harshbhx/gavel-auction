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

  it('keeps /metrics working', async () => {
    const url = await boot();
    expect((await fetch(`${url}/metrics`)).status).toBe(401);
    const res = await fetch(`${url}/metrics`, { headers: { 'x-admin-key': KEY } });
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty('bids');
  });
});
