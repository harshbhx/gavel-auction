import { afterEach, describe, expect, it } from 'vitest';
import { connect } from 'node:net';
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
    const port = await boot({
      RATE_HTTP_BURST: '1',
      RATE_HTTP_PER_MIN: '1',
      RATE_HTTP_READ_BURST: '1',
      RATE_HTTP_READ_PER_MIN: '1',
    });
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

  /** Raw upgrade with a bad Sec-WebSocket-Key: the server refuses it and closes. */
  const badUpgrade = (port: number): Promise<void> =>
    new Promise((resolve) => {
      const sock = connect(port, '127.0.0.1', () => {
        sock.write(
          'GET /ws HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n' +
            `Origin: ${ORIGIN}\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: bad\r\n\r\n`,
        );
      });
      sock.on('error', () => undefined);
      sock.resume();
      sock.on('close', () => resolve());
    });

  it('does not leak slots on failed handshakes', async () => {
    const port = await boot({ RATE_JOIN_BURST: '1000' });
    for (let i = 0; i < 25; i += 1) await badUpgrade(port);
    expect(await upgrade(port)).toBe(101);
  });

  it('caps open sockets at 20 per address', async () => {
    const port = await boot({ RATE_JOIN_BURST: '1000' });
    const codes: number[] = [];
    for (let i = 0; i < 21; i += 1) codes.push(await upgrade(port));
    expect(codes.slice(0, 20).every((c) => c === 101)).toBe(true);
    expect(codes[20]).toBe(429);
  });
});
