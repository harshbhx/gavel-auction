import { SystemClock } from '@gavel/shared';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { composeServer, type Composed } from '../src/boot/compose';

// TST-12 (issue 2410, gap 7): GAVEL_MAX_CEILING_CENTS is enforced on every path that can carry a
// ceiling or an amount: the HTTP hold create, the judge-room sim-hold, the judge bid route and
// the WebSocket bid. One boot per cap, in-process, on the fake PayPal; no network.
//
// The "same family" is: the two hold paths refuse the limit itself (400, ceiling out of range /
// bad_message); the two bid paths refuse the amount with the engine reason over_ceiling, because
// no registered limit can sit above the cap. Nothing above the cap is ever accepted.

const ORIGIN = 'http://localhost:8080';
const base = {
  PUBLIC_URL: ORIGIN,
  TOKEN_SECRET: 'test-secret-test-secret-test-secret-0123',
  ADMIN_KEY: 'test-admin-key-test-admin-key',
  PAYMENTS: 'fake',
  LOG_LEVEL: 'error',
  JUDGE_ROOMS: 'true',
};
const json = { 'content-type': 'application/json' };
const clock = new SystemClock();
const running: Composed[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate();
  for (const app of running.splice(0)) await app.close(200);
});

interface Frame {
  t: string;
  [k: string]: unknown;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function until<T>(read: () => T | undefined, what: string): Promise<T> {
  const end = clock.now() + 5000;
  for (;;) {
    const got = read();
    if (got !== undefined) return got;
    if (clock.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(25);
  }
}

describe('TST-12: the ceiling cap holds on every path', () => {
  it.each([3000, 7500])(
    'cap %i: HTTP hold, sim-hold, judge bid and socket bid all refuse above it',
    async (cap) => {
      const app = await composeServer(
        { ...base, GAVEL_MAX_CEILING_CENTS: String(cap) },
        { sink: () => undefined },
      );
      running.push(app);
      const port = await app.listen(0);
      const url = `http://127.0.0.1:${port}`;
      const post = async (path: string, body: unknown, token?: string) => {
        const res = await fetch(`${url}${path}`, {
          method: 'POST',
          headers: {
            ...json,
            ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
          },
          body: JSON.stringify(body),
        });
        return { status: res.status, body: (await res.json()) as Record<string, unknown> };
      };

      const made = await post('/api/judge/rooms', {});
      expect(made.status).toBe(201);
      const { auctionId, joinCode, auctioneerToken } = made.body as {
        auctionId: string;
        joinCode: string;
        auctioneerToken: string;
      };
      const joined = await post('/api/judge/join', { code: joinCode, displayName: 'Cap Tester' });
      expect(joined.status).toBe(200);
      const token = joined.body['sessionToken'] as string;
      const over = cap + 1;

      // Hold paths first, before the bidder is registered: both refuse, nothing is written.
      const http = await post('/api/holds', { auctionId, ceilingCents: over }, token);
      expect(http.status).toBe(400);
      expect(http.body['error']).toBe('ceiling_out_of_range');
      const hugeHttp = await post('/api/holds', { auctionId, ceilingCents: cap * 10 }, token);
      expect(hugeHttp.status).toBe(400);

      const simOver = await post(
        `/api/judge/rooms/${auctionId}/sim-hold`,
        { ceilingCents: over, name: 'Cap Tester' },
        token,
      );
      expect(simOver.status).toBe(400);
      expect(simOver.body['error']).toBe('bad_message');

      // Control: exactly the cap is accepted, so the refusals above are about the cap.
      const simOk = await post(
        `/api/judge/rooms/${auctionId}/sim-hold`,
        { ceilingCents: cap, name: 'Cap Tester' },
        token,
      );
      expect(simOk.status).toBe(200);

      await post(
        `/api/auctions/${auctionId}/control`,
        { controlId: 'open-1', action: 'open' },
        auctioneerToken,
      );

      // Judge bid route: refused with the engine reason, not accepted.
      const viaHttp = await post(`/api/judge/rooms/${auctionId}/bids`, { amount: over }, token);
      expect(viaHttp.status).toBe(409);
      expect(viaHttp.body).toMatchObject({ accepted: false, reason: 'over_ceiling' });

      // WebSocket bid: the same reason.
      const frames: Frame[] = [];
      const ws = await new Promise<WebSocket>((resolve, reject) => {
        const s = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: ORIGIN });
        sockets.push(s);
        s.on('message', (m) => frames.push(JSON.parse(String(m)) as Frame));
        s.on('unexpected-response', (_req, res) =>
          reject(new Error(`handshake ${res.statusCode}`)),
        );
        s.on('error', reject);
        s.on('open', () => {
          s.send(JSON.stringify({ v: 1, t: 'join', token, auctionId }));
          resolve(s);
        });
      });
      await until(() => frames.find((f) => f.t === 'state'), 'state frame');
      ws.send(
        JSON.stringify({
          v: 1,
          t: 'bid',
          mid: '01J000000000000000000000AA',
          amount: over,
          source: 'manual',
        }),
      );
      const rejected = await until(() => frames.find((f) => f.t === 'bid_rejected'), 'rejection');
      expect(rejected['reason']).toBe('over_ceiling');
      expect(frames.some((f) => f.t === 'bid_accepted')).toBe(false);
    },
  );
});
