import { SystemClock } from '@gavel/shared';
import { encodeBatch } from '@gavel/voice';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { composeServer, type Composed } from '../src/boot/compose';
import { signToken, type TokenPayload } from '../src/auth/token';

const SECRET = 'test-secret-test-secret-test-secret-0123';
const ORIGIN = 'http://localhost:8080';
const AUCTION = '01HZZZZZZZZZZZZZZZZZZZZZZA';
const JTI_A = '01HZZZZZZZZZZZZZZZZZZZZZZB';
const JTI_B = '01HZZZZZZZZZZZZZZZZZZZZZZC';
const BIDDER = '01HZZZZZZZZZZZZZZZZZZZZZZD';

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

async function boot(extra: Record<string, string> = {}): Promise<number> {
  const app = await composeServer({ ...env, ...extra }, { sink: () => undefined });
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

function token(over: Partial<TokenPayload> = {}): Promise<string> {
  const nowS = Math.floor(new SystemClock().now() / 1000);
  return signToken(
    {
      kind: 'auctioneer',
      aud: AUCTION,
      sub: 'auctioneer-1',
      jti: JTI_A,
      iat: nowS,
      exp: nowS + 3600,
      ...over,
    },
    SECRET,
  );
}

type Outcome = { status: number } | { ws: WebSocket };

function connect(
  port: number,
  query: Record<string, string>,
  origin: string | undefined = ORIGIN,
): Promise<Outcome> {
  return new Promise((resolve) => {
    const qs = new URLSearchParams(query).toString();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/audio?${qs}`, origin ? { origin } : {});
    sockets.push(ws);
    ws.on('error', () => undefined);
    ws.on('open', () => resolve({ ws }));
    ws.on('unexpected-response', (_req, res) => {
      resolve({ status: res.statusCode ?? 0 });
      res.resume();
    });
  });
}

function closed(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) =>
    ws.on('close', (code, reason) => resolve({ code, reason: reason.toString('utf8') })),
  );
}

const frame = (): Uint8Array =>
  encodeBatch({ seq: 0, tsMs: 0, flags: 0, pcm: new Int16Array(320) });

describe('/audio route (HRD-67)', () => {
  it('refuses an upgrade without a token, with a bad origin, or for an unknown auction', async () => {
    const port = await boot();
    expect(await connect(port, { auction: AUCTION })).toEqual({ status: 401 });
    expect(await connect(port, { auction: AUCTION, token: 'nope' })).toEqual({ status: 401 });
    const t = await token();
    expect(await connect(port, { auction: AUCTION, token: t }, 'http://evil.example')).toEqual({
      status: 403,
    });
    const other = await token({ aud: '01HZZZZZZZZZZZZZZZZZZZZZZE' });
    expect(await connect(port, { auction: '01HZZZZZZZZZZZZZZZZZZZZZZE', token: other })).toEqual({
      status: 404,
    });
  });

  it('accepts only the auctioneer token: a bidder session or a token for another auction is refused', async () => {
    const port = await boot();
    const session = await token({ kind: 'session', sub: BIDDER, bidderId: BIDDER, jti: JTI_B });
    expect(await connect(port, { auction: AUCTION, token: session })).toEqual({ status: 401 });
    const wrongAud = await token({ aud: '01HZZZZZZZZZZZZZZZZZZZZZZF' });
    expect(await connect(port, { auction: AUCTION, token: wrongAud })).toEqual({ status: 401 });
  });

  it('keeps a stream open for valid binary batches and needs no speech key', async () => {
    const port = await boot();
    const out = await connect(port, { auction: AUCTION, token: await token() });
    if (!('ws' in out)) throw new Error(`refused with ${out.status}`);
    out.ws.send(frame());
    out.ws.send(frame());
    await new Promise((r) => setTimeout(r, 150));
    expect(out.ws.readyState).toBe(WebSocket.OPEN);
  });

  it('closes with AUDIO_BAD_FRAME on a text message or a malformed batch', async () => {
    const port = await boot();
    for (const bad of ['hello', new Uint8Array([1, 2, 3])]) {
      const out = await connect(port, { auction: AUCTION, token: await token() });
      if (!('ws' in out)) throw new Error(`refused with ${out.status}`);
      const end = closed(out.ws);
      out.ws.send(bad);
      expect(await end).toEqual({ code: 1008, reason: 'AUDIO_BAD_FRAME' });
    }
  });

  it('allows one stream per room and source: a second token on the same source is busy', async () => {
    const port = await boot();
    const first = await connect(port, { auction: AUCTION, token: await token(), source: 'mic' });
    if (!('ws' in first)) throw new Error('first refused');
    const second = await connect(port, {
      auction: AUCTION,
      token: await token({ jti: JTI_B }),
      source: 'mic',
    });
    if (!('ws' in second)) throw new Error('second refused at upgrade');
    expect(await closed(second.ws)).toEqual({ code: 4409, reason: 'AUDIO_STREAM_BUSY' });
    expect(first.ws.readyState).toBe(WebSocket.OPEN);
  });

  it('starts with VOICE_STT=groq but no key (cached provider takes over)', async () => {
    const port = await boot({ VOICE_STT: 'groq' });
    const out = await connect(port, { auction: AUCTION, token: await token() });
    expect('ws' in out).toBe(true);
  });
});
