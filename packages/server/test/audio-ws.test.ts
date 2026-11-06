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

/** Opens the socket with no credential in the URL; the caller sends the auth message itself. */
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

/** Opens the socket and sends the first-frame auth message with `tok`. */
async function open(
  port: number,
  tok: string,
  query: Record<string, string> = { auction: AUCTION },
): Promise<WebSocket> {
  const out = await connect(port, query);
  if (!('ws' in out)) throw new Error(`refused with ${out.status}`);
  out.ws.send(JSON.stringify({ t: 'auth', token: tok }));
  return out.ws;
}

function closed(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) =>
    ws.on('close', (code, reason) => resolve({ code, reason: reason.toString('utf8') })),
  );
}

const frame = (): Uint8Array =>
  encodeBatch({ seq: 0, tsMs: 0, flags: 0, pcm: new Int16Array(320) });

const UNAUTHORIZED = { code: 4401, reason: 'AUDIO_UNAUTHORIZED' };

describe('/audio route (HRD-67)', () => {
  it('refuses an upgrade with a bad origin or no auction, and keeps the token out of the URL', async () => {
    const port = await boot();
    expect(await connect(port, {})).toEqual({ status: 400 });
    expect(await connect(port, { auction: AUCTION }, 'http://evil.example')).toEqual({
      status: 403,
    });
    expect(await connect(port, { auction: AUCTION }, '')).toEqual({ status: 403 });
  });

  it('closes a socket that sends no auth message within the deadline', async () => {
    const port = await boot();
    const out = await connect(port, { auction: AUCTION });
    if (!('ws' in out)) throw new Error(`refused with ${out.status}`);
    expect(await closed(out.ws)).toEqual(UNAUTHORIZED);
  }, 15_000);

  it('closes with 4401 when audio arrives before auth', async () => {
    const port = await boot();
    const out = await connect(port, { auction: AUCTION });
    if (!('ws' in out)) throw new Error(`refused with ${out.status}`);
    const end = closed(out.ws);
    out.ws.send(frame());
    expect(await end).toEqual(UNAUTHORIZED);
  });

  it('closes with 4401 on a malformed auth message', async () => {
    const port = await boot();
    for (const bad of ['hello', '{"t":"auth"}', '{"t":"nope","token":"x"}', '[]']) {
      const out = await connect(port, { auction: AUCTION });
      if (!('ws' in out)) throw new Error(`refused with ${out.status}`);
      const end = closed(out.ws);
      out.ws.send(bad);
      expect(await end).toEqual(UNAUTHORIZED);
    }
  });

  it('closes with 4401 on an invalid token, and a token for another auction is unauthorized', async () => {
    const port = await boot();
    const bad = await open(port, 'nope');
    expect(await closed(bad)).toEqual(UNAUTHORIZED);
    const wrongAud = await open(port, await token({ aud: '01HZZZZZZZZZZZZZZZZZZZZZZF' }));
    expect(await closed(wrongAud)).toEqual(UNAUTHORIZED);
  });

  it('accepts only the auctioneer token: a bidder session is refused', async () => {
    const port = await boot();
    const session = await token({ kind: 'session', sub: BIDDER, bidderId: BIDDER, jti: JTI_B });
    expect(await closed(await open(port, session))).toEqual(UNAUTHORIZED);
  });

  it('closes for an unknown auction after a valid token', async () => {
    const port = await boot();
    const other = '01HZZZZZZZZZZZZZZZZZZZZZZE';
    const ws = await open(port, await token({ aud: other }), { auction: other });
    expect(await closed(ws)).toEqual({ code: 4404, reason: 'not_found' });
  });

  it('keeps a stream open for valid binary batches and needs no speech key', async () => {
    const port = await boot();
    const ws = await open(port, await token());
    ws.send(frame());
    ws.send(frame());
    await new Promise((r) => setTimeout(r, 150));
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  it('closes with AUDIO_BAD_FRAME on a text message or a malformed batch after auth', async () => {
    const port = await boot();
    for (const bad of ['hello', new Uint8Array([1, 2, 3])]) {
      const ws = await open(port, await token());
      const end = closed(ws);
      ws.send(bad);
      expect(await end).toEqual({ code: 1008, reason: 'AUDIO_BAD_FRAME' });
    }
  });

  it('allows one stream per room and source: a second token on the same source is busy', async () => {
    const port = await boot();
    const first = await open(port, await token(), { auction: AUCTION, source: 'mic' });
    await new Promise((r) => setTimeout(r, 100));
    const second = await open(port, await token({ jti: JTI_B }), {
      auction: AUCTION,
      source: 'mic',
    });
    expect(await closed(second)).toEqual({ code: 4409, reason: 'AUDIO_STREAM_BUSY' });
    expect(first.readyState).toBe(WebSocket.OPEN);
  });

  it('starts with VOICE_STT=groq but no key (cached provider takes over)', async () => {
    const port = await boot({ VOICE_STT: 'groq' });
    const ws = await open(port, await token());
    await new Promise((r) => setTimeout(r, 150));
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });
});
