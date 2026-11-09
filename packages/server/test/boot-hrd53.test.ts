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

describe('socket upgrades are limited per address (RT4-sec-09, FIX-84)', () => {
  /** Opens a socket and reports what the browser can see: 101 then the first frame and close. */
  interface Outcome {
    status: number;
    frame?: { t: string; code: string; message: string; retryAfterMs?: number };
    closeCode?: number;
    closeReason?: string;
  }
  const upgrade = (port: number, origin: string = ORIGIN): Promise<Outcome> =>
    new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin });
      sockets.push(ws);
      const out: Outcome = { status: 101 };
      ws.on('unexpected-response', (_req, res) => resolve({ status: res.statusCode ?? 0 }));
      ws.on('message', (data) => {
        out.frame = JSON.parse(String(data)) as Outcome['frame'];
      });
      ws.on('close', (code, reason) => {
        out.closeCode = code;
        out.closeReason = reason.toString('utf8');
        resolve(out);
      });
      // An admitted socket stays open: report it once the handshake is done and nothing follows.
      ws.on('open', () => {
        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) resolve(out);
        }, 150);
      });
      ws.on('error', () => undefined);
    });

  it('tells the 4th socket, once the join budget is spent, with a 4429 close and a frame', async () => {
    const port = await boot({ RATE_JOIN_BURST: '3', RATE_JOIN_PER_MIN: '1' });
    const outcomes: Outcome[] = [];
    for (let i = 0; i < 5; i += 1) outcomes.push(await upgrade(port));
    expect(outcomes.slice(0, 3).map((o) => o.closeCode)).toEqual([undefined, undefined, undefined]);
    for (const o of outcomes.slice(3)) {
      expect(o.status).toBe(101);
      expect(o.closeCode).toBe(4429);
      expect(o.closeReason).toBe('too_many_connections');
      expect(o.frame).toMatchObject({ t: 'error', code: 'rate_limited' });
      expect(o.frame?.message).toBe('too_many_connections');
      expect(o.frame?.retryAfterMs).toBeGreaterThan(0);
    }
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
    expect((await upgrade(port)).closeCode).toBeUndefined();
  });

  it('closes the 21st socket from one address with 4429 and a retry hint', async () => {
    const port = await boot({ RATE_JOIN_BURST: '1000' });
    const outcomes: Outcome[] = [];
    for (let i = 0; i < 21; i += 1) outcomes.push(await upgrade(port));
    expect(outcomes.slice(0, 20).every((o) => o.status === 101 && o.closeCode === undefined)).toBe(
      true,
    );
    const last = outcomes[20];
    expect(last?.status).toBe(101);
    expect(last?.closeCode).toBe(4429);
    expect(last?.frame).toMatchObject({ t: 'error', code: 'rate_limited', retryAfterMs: 10_000 });
  });

  it('still refuses a wrong Origin with 403, with or without a spent budget', async () => {
    const port = await boot({ RATE_JOIN_BURST: '1', RATE_JOIN_PER_MIN: '1' });
    expect((await upgrade(port, 'https://evil.example')).status).toBe(403);
    await upgrade(port);
    expect((await upgrade(port, 'https://evil.example')).status).toBe(403);
    expect((await upgrade(port)).closeCode).toBe(4429);
  });
});
