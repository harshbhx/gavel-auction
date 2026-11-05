import { SystemClock } from '@gavel/shared';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { composeServer, type Composed } from '../src/boot/compose';
import { signToken } from '../src/auth/token';
import { RATE_LIMITED_CODE } from '../src/host/node-ws';

const SECRET = 'test-secret-test-secret-test-secret-0123';
const ORIGIN = 'http://localhost:8080';
const AUCTION = '01HZZZZZZZZZZZZZZZZZZZZZZA';
const JTI = '01HZZZZZZZZZZZZZZZZZZZZZZB';

const env = {
  PUBLIC_URL: ORIGIN,
  TOKEN_SECRET: SECRET,
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

async function boot(): Promise<number> {
  const app = await composeServer(env, { sink: () => undefined });
  running.push(app);
  await app.service.createAuction(
    AUCTION as never,
    {
      mode: 'english',
      currency: 'USD',
      reserve: 10000,
      minIncrement: 500,
      endTs: new SystemClock().now() + 3_600_000,
      softCloseWindowMs: 30_000,
      softCloseExtensionMs: 30_000,
      maxExtensions: 5,
      ceilingPresets: [30000, 50000],
      confirmConfidenceThreshold: 0.85,
    } as never,
    'auctioneer-1',
  );
  return app.listen(0);
}

async function auctioneerToken(): Promise<string> {
  const nowS = Math.floor(new SystemClock().now() / 1000);
  return signToken(
    {
      kind: 'auctioneer',
      aud: AUCTION,
      sub: 'auctioneer-1',
      jti: JTI,
      iat: nowS,
      exp: nowS + 3600,
    },
    SECRET,
  );
}

function open(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: ORIGIN });
    sockets.push(ws);
    ws.on('error', () => undefined);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

const nextFrame = (ws: WebSocket): Promise<Record<string, unknown>> =>
  new Promise((resolve) => {
    ws.once('message', (data) => resolve(JSON.parse(String(data)) as Record<string, unknown>));
  });

const closeCode = (ws: WebSocket): Promise<{ code: number; reason: string }> =>
  new Promise((resolve) => {
    ws.once('close', (code, reason) => resolve({ code, reason: reason.toString('utf8') }));
  });

const join = (token: string): string =>
  JSON.stringify({ v: 1, t: 'join', token, auctionId: AUCTION });

describe('websocket gateway mounted in composeServer', () => {
  it('joins with a valid token and answers with the room state', async () => {
    const port = await boot();
    const ws = await open(port);
    const first = nextFrame(ws);
    ws.send(join(await auctioneerToken()));
    expect((await first).t).toBe('state');
  });

  it('closes 4401 on a token that does not verify', async () => {
    const port = await boot();
    const ws = await open(port);
    const closed = closeCode(ws);
    ws.send(join('not-a-token'));
    expect((await closed).code).toBe(4401);
  });

  it('keeps the health routes next to the socket', async () => {
    const port = await boot();
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(res.status).toBe(200);
  });

  it('closes with RATE_LIMITED when one socket floods frames (issue #285)', async () => {
    const port = await boot();
    const ws = await open(port);
    const state = nextFrame(ws);
    ws.send(join(await auctioneerToken()));
    await state;
    const closed = closeCode(ws);
    for (let i = 0; i < 200; i += 1) {
      ws.send(JSON.stringify({ v: 1, t: 'confirm_response', confirmId: 'c1', accept: true }));
    }
    const end = await closed;
    expect(end.code).toBe(RATE_LIMITED_CODE);
    expect(end.reason).toBe('RATE_LIMITED');
  });
});
