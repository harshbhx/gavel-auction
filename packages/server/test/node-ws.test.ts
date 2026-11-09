import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ManualClock } from '@gavel/shared';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createNodeWsHost, type NodeWsHost } from '../src/host/node-ws';

const ORIGIN = 'https://auction.example';

let server: Server | undefined;
let host: NodeWsHost | undefined;

const start = async (): Promise<number> => {
  const s = http.createServer((req, res) => {
    if (host?.handleRequest(req, res)) return;
    res.writeHead(404).end();
  });
  server = s;
  host = createNodeWsHost({
    server: s,
    clock: new ManualClock(1_789_000_000_000),
    allowedOrigins: [ORIGIN],
    accept: () => ({ onJoin: () => undefined, onFrame: () => undefined }),
  });
  await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', resolve));
  return (s.address() as AddressInfo).port;
};

afterEach(async () => {
  await host?.close();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
  host = undefined;
});

describe('node ws host (R-RT-074, T-RT-057)', () => {
  it('refuses a bad Origin with 403', async () => {
    const port = await start();
    const status = await new Promise<number>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: 'https://evil.example' });
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.on('open', () => reject(new Error('opened')));
      ws.on('error', () => undefined);
    });
    expect(status).toBe(403);
  });

  it('refuses the null origin and an origin that is only a prefix match with 403', async () => {
    const port = await start();
    for (const origin of ['null', `${ORIGIN}.evil.example`]) {
      const status = await new Promise<number>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin });
        ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
        ws.on('open', () => reject(new Error('opened')));
        ws.on('error', () => undefined);
      });
      expect(status, origin).toBe(403);
    }
  });

  it('closes 1009 on a 16385 byte frame', async () => {
    const port = await start();
    const code = await new Promise<number>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: ORIGIN });
      ws.on('open', () => ws.send('x'.repeat(16_385)));
      ws.on('close', (c) => resolve(c));
      ws.on('error', reject);
    });
    expect(code).toBe(1009);
  });

  it('answers a plain GET /ws with 426', async () => {
    const port = await start();
    const status = await new Promise<number>((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${port}/ws`, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        })
        .on('error', reject);
    });
    expect(status).toBe(426);
  });
});
