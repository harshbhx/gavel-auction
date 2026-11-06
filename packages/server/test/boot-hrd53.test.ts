import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { composeServer, type Composed } from '../src/boot/compose';

const ORIGIN = 'http://localhost:8080';
const base = {
  PUBLIC_URL: ORIGIN,
  TOKEN_SECRET: 'test-secret-test-secret-test-secret-0123',
  ADMIN_KEY: 'test-admin-key-test-admin-key',
  PAYMENTS: 'fake',
  LOG_LEVEL: 'error',
};

const running: Composed[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate();
  for (const app of running.splice(0)) await app.close(200);
});

async function boot(env: Record<string, string> = {}): Promise<number> {
  const app = await composeServer({ ...base, ...env }, { sink: () => undefined });
  running.push(app);
  return app.listen(0);
}

const HEADERS = [
  'content-security-policy',
  'strict-transport-security',
  'x-content-type-options',
  'referrer-policy',
];

describe('security headers on every live route (RT4-sec-08)', () => {
  it('sends them on probes, ops routes, 401s and the 404', async () => {
    const port = await boot();
    const url = `http://127.0.0.1:${port}`;
    for (const path of [
      '/healthz',
      '/readyz',
      '/version',
      '/metrics',
      '/ops/rooms',
      '/warmup',
      '/nope',
    ]) {
      const res = await fetch(`${url}${path}`);
      for (const name of HEADERS) expect(res.headers.get(name), `${path} ${name}`).toBeTruthy();
      await res.arrayBuffer();
    }
  });

  it('sends them on the 429', async () => {
    const port = await boot({ RATE_HTTP_BURST: '1', RATE_HTTP_PER_MIN: '1' });
    const url = `http://127.0.0.1:${port}`;
    await (await fetch(`${url}/nope`)).arrayBuffer();
    const res = await fetch(`${url}/nope`);
    expect(res.status).toBe(429);
    for (const name of HEADERS) expect(res.headers.get(name), name).toBeTruthy();
  });
});

describe('socket upgrades are limited per address (RT4-sec-09)', () => {
  const upgrade = (port: number): Promise<number> =>
    new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: ORIGIN });
      sockets.push(ws);
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.on('open', () => resolve(101));
      ws.on('error', () => undefined);
    });

  it('answers 429 once the join budget is spent', async () => {
    const port = await boot({ RATE_JOIN_BURST: '3', RATE_JOIN_PER_MIN: '1' });
    const codes: number[] = [];
    for (let i = 0; i < 5; i += 1) codes.push(await upgrade(port));
    expect(codes).toEqual([101, 101, 101, 429, 429]);
  });
});
