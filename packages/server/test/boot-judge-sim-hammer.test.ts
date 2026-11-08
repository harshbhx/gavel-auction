import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SystemClock } from '@gavel/shared';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { composeServer, type Composed } from '../src/boot/compose';

// SRV-39: the hammer of a judge room whose bidders hold simulated authorizations, run through the
// whole composition (HTTP, WebSocket, settlement saga, file-less stores) on the fake PayPal.

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
const dirs: string[] = [];
const rejections: unknown[] = [];
const onRejection = (e: unknown): void => void rejections.push(e);
process.on('unhandledRejection', onRejection);

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate();
  for (const app of running.splice(0)) await app.close(200);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  rejections.splice(0);
});

interface Frame {
  t: string;
  [k: string]: unknown;
}

let counter = 0;
const ulid = (): string => `01${String((counter += 1)).padStart(24, '0')}`;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function until<T>(read: () => T | undefined, ms: number, what: string): Promise<T> {
  const end = clock.now() + ms;
  for (;;) {
    const got = read();
    if (got !== undefined) return got;
    if (clock.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(50);
  }
}

function open(
  port: number,
  token: string,
  auctionId: string,
): Promise<{ ws: WebSocket; frames: Frame[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: ORIGIN });
    sockets.push(ws);
    const frames: Frame[] = [];
    ws.on('message', (m) => frames.push(JSON.parse(String(m)) as Frame));
    ws.on('unexpected-response', (_req, res) => reject(new Error(`handshake ${res.statusCode}`)));
    ws.on('error', reject);
    ws.on('open', () => {
      ws.send(JSON.stringify({ v: 1, t: 'join', token, auctionId }));
      resolve({ ws, frames });
    });
  });
}

describe('SRV-39: hammer of a judge room with simulated holds', () => {
  // Bids are [bidder index, cents]. The price is what the winner pays, whatever the ceiling.
  const cases = [
    {
      name: 'winner below ceiling',
      ceilings: [5000, 5000],
      bids: [
        [0, 1500],
        [1, 2000],
      ],
      win: 1,
      price: 2000,
    },
    {
      name: 'winner bid equals its ceiling',
      ceilings: [2000, 5000],
      bids: [[0, 2000]],
      win: 0,
      price: 2000,
    },
    {
      name: 'a single bid at the reserve',
      ceilings: [5000, 5000],
      bids: [[1, 1000]],
      win: 1,
      price: 1000,
    },
  ] as const;
  it.each(cases)(
    '$name: captures the winner, releases the loser, reaches SETTLED',
    async (c) => {
      const lines: string[] = [];
      const app = await composeServer(base, { sink: (l) => void lines.push(l) });
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
        return { status: res.status, body: (await res.json()) as Record<string, string> };
      };

      const made = await post('/api/judge/rooms', {});
      expect(made.status).toBe(201);
      const { auctionId, joinCode, auctioneerToken } = made.body as {
        auctionId: string;
        joinCode: string;
        auctioneerToken: string;
      };

      const bidders: Array<{ token: string; bidderId: string }> = [];
      for (const [i, name] of ['Sim A', 'Sim B'].entries()) {
        const joined = await post('/api/judge/join', { code: joinCode, displayName: name });
        expect(joined.status).toBe(200);
        const token = joined.body.sessionToken as string;
        const hold = await post(
          `/api/judge/rooms/${auctionId}/sim-hold`,
          { ceilingCents: c.ceilings[i] ?? 5000, name },
          token,
        );
        expect(hold.status).toBe(200);
        bidders.push({ token, bidderId: joined.body.bidderId as string });
      }

      // A may already be open; either answer leaves the lot open.
      await post(
        `/api/auctions/${auctionId}/control`,
        { controlId: 'open-1', action: 'open' },
        auctioneerToken,
      );

      const conns = [];
      for (const b of bidders) conns.push(await open(port, b.token, auctionId));
      await Promise.all(
        conns.map((c) => until(() => c.frames.find((f) => f.t === 'state'), 5000, 'state')),
      );
      for (const [who, amount] of c.bids) {
        const conn = conns[who];
        if (conn === undefined) throw new Error('socket expected');
        const before = conn.frames.filter((f) => f.t === 'bid_accepted').length;
        conn.ws.send(JSON.stringify({ v: 1, t: 'bid', mid: ulid(), amount, source: 'manual' }));
        await until(
          () =>
            conn.frames.filter((f) => f.t === 'bid_accepted').length > before ? true : undefined,
          5000,
          `bid ${amount} accepted`,
        );
      }
      const [a, b] = conns;
      if (a === undefined || b === undefined) throw new Error('two sockets expected');

      const hammer = await post(
        `/api/auctions/${auctionId}/control`,
        { controlId: 'hammer-1', action: 'hammer', args: { closeNow: 1 } },
        auctioneerToken,
      );
      expect(hammer.status).toBe(200);
      expect((hammer.body as { hammer?: { price: number } }).hammer?.price).toBe(c.price);

      // Settlement finishes: the winner's simulated hold is captured, the loser's is released.
      const final = await until(
        () =>
          [...a.frames, ...b.frames].find(
            (f) =>
              f.t === 'settlement_update' &&
              (f.auctionState === 'SETTLED' || f.auctionState === 'FAILED_NEEDS_REVIEW'),
          ),
        60_000,
        'terminal settlement',
      );
      const dump = (): string => lines.filter((l) => l.includes('settlement stopped')).join('\n');
      expect(final.auctionState, dump()).toBe('SETTLED');
      expect(final.amountCaptured).toBe(c.price);

      // Receipt data: the winner's simulated hold is CAPTURED for the price, the loser's is VOIDED.
      for (const [i, bidder] of bidders.entries()) {
        const link = await post(`/api/auctions/${auctionId}/receipt-link`, {}, bidder.token);
        expect(link.status).toBe(200);
        const receipt = await fetch(`${url}/api/auctions/${auctionId}/receipt`, {
          headers: { authorization: `Bearer ${link.body.token ?? ''}` },
        });
        expect(receipt.status).toBe(200);
        const cut = (await receipt.json()) as {
          snapshot: { settlement?: { auctionState: string; yourHold?: Record<string, unknown> } };
        };
        expect(cut.snapshot.settlement?.auctionState).toBe('SETTLED');
        const hold = cut.snapshot.settlement?.yourHold;
        if (i === c.win) {
          expect(hold).toMatchObject({ status: 'CAPTURED', capturedCents: c.price });
        } else {
          expect(hold).toMatchObject({ status: 'VOIDED', capturedCents: 0 });
        }
      }

      // The server still serves: probes, a new socket, a new room.
      expect((await fetch(`${url}/healthz`)).status).toBe(200);
      const again = await open(port, auctioneerToken, auctionId);
      await until(() => again.frames.find((f) => f.t === 'state'), 5000, 'state after settlement');
      expect((await post('/api/judge/rooms', {})).status).toBe(201);

      // Nothing escaped the settlement as an unhandled rejection, and no run stopped on an error.
      await sleep(300);
      expect(rejections).toEqual([]);
      expect(dump()).toBe('');
    },
    90_000,
  );

  it('answers an unsold hammer and survives the retry window', async () => {
    const lines: string[] = [];
    const app = await composeServer(base, { sink: (l) => void lines.push(l) });
    running.push(app);
    const port = await app.listen(0);
    const url = `http://127.0.0.1:${port}`;
    const post = async (path: string, body: unknown, token?: string) => {
      const res = await fetch(`${url}${path}`, {
        method: 'POST',
        headers: { ...json, ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) },
        body: JSON.stringify(body),
      });
      return { status: res.status, body: (await res.json()) as Record<string, string> };
    };
    const made = await post('/api/judge/rooms', {});
    const { auctionId, joinCode, auctioneerToken } = made.body as {
      auctionId: string;
      joinCode: string;
      auctioneerToken: string;
    };
    const tokens: string[] = [];
    for (const name of ['Sim A', 'Sim B']) {
      const joined = await post('/api/judge/join', { code: joinCode, displayName: name });
      const token = joined.body.sessionToken as string;
      expect(
        (await post(`/api/judge/rooms/${auctionId}/sim-hold`, { ceilingCents: 2000, name }, token))
          .status,
      ).toBe(200);
      tokens.push(token);
    }
    const watcher = await open(port, tokens[0] ?? '', auctionId);
    const hammer = await post(
      `/api/auctions/${auctionId}/control`,
      { controlId: 'hammer-2', action: 'hammer', args: { closeNow: 1 } },
      auctioneerToken,
    );
    expect(hammer.status).toBe(200);
    await until(
      () =>
        watcher.frames.find(
          (f) =>
            f.t === 'settlement_update' &&
            (f.auctionState === 'SETTLED' || f.auctionState === 'FAILED_NEEDS_REVIEW'),
        ),
      60_000,
      'terminal settlement',
    );
    // A retry armed by the first run fires after 15 s: wait it out, then probe again.
    await sleep(20_000);
    expect((await fetch(`${url}/healthz`)).status).toBe(200);
    await open(port, tokens[1] ?? '', auctionId);
    expect(rejections).toEqual([]);
    expect(lines.filter((l) => l.includes('settlement stopped'))).toEqual([]);
  }, 120_000);

  it('survives a restart right after the hammer: one settlement, a retried hammer is a no-op', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gavel-srv39-'));
    dirs.push(dir);
    const env = { ...base, STORE: 'file', DATA_DIR: dir };
    const lines: string[] = [];
    const post = async (url: string, path: string, body: unknown, token?: string) => {
      const res = await fetch(`${url}${path}`, {
        method: 'POST',
        headers: { ...json, ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) },
        body: JSON.stringify(body),
      });
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    };

    const first = await composeServer(env, { sink: (l) => void lines.push(l) });
    running.push(first);
    const port1 = await first.listen(0);
    const url1 = `http://127.0.0.1:${port1}`;
    const made = await post(url1, '/api/judge/rooms', {});
    const { auctionId, joinCode, auctioneerToken } = made.body as {
      auctionId: string;
      joinCode: string;
      auctioneerToken: string;
    };
    const tokens: string[] = [];
    for (const name of ['Sim A', 'Sim B']) {
      const joined = await post(url1, '/api/judge/join', { code: joinCode, displayName: name });
      const token = joined.body.sessionToken as string;
      const hold = await post(
        url1,
        `/api/judge/rooms/${auctionId}/sim-hold`,
        { ceilingCents: 5000, name },
        token,
      );
      expect(hold.status).toBe(200);
      tokens.push(token);
    }
    const conns = [];
    for (const token of tokens) conns.push(await open(port1, token, auctionId));
    await Promise.all(
      conns.map((c) => until(() => c.frames.find((f) => f.t === 'state'), 5000, 'state')),
    );
    const [a, b] = conns;
    if (a === undefined || b === undefined) throw new Error('two sockets expected');
    a.ws.send(JSON.stringify({ v: 1, t: 'bid', mid: ulid(), amount: 1500, source: 'manual' }));
    await until(() => a.frames.find((f) => f.t === 'bid_accepted'), 5000, 'bid A accepted');
    b.ws.send(JSON.stringify({ v: 1, t: 'bid', mid: ulid(), amount: 2000, source: 'manual' }));
    await until(() => b.frames.find((f) => f.t === 'bid_accepted'), 5000, 'bid B accepted');

    const hammer = { controlId: 'hammer-restart', action: 'hammer', args: { closeNow: 1 } };
    const path = `/api/auctions/${auctionId}/control`;
    expect((await post(url1, path, hammer, auctioneerToken)).status).toBe(200);
    // The client lost the answer and sends the same controlId again: same answer, no second hammer.
    const retry = await post(url1, path, hammer, auctioneerToken);
    expect(retry.status).toBe(200);
    // The platform restarts the instance now, with the settlement possibly mid-flight.
    for (const ws of sockets.splice(0)) ws.terminate();
    await first.close(200);
    running.splice(0);

    const second = await composeServer(env, { sink: (l) => void lines.push(l) });
    running.push(second);
    const port2 = await second.listen(0);
    const url2 = `http://127.0.0.1:${port2}`;
    const again = await open(port2, tokens[0] ?? '', auctionId);
    const final = await until(
      () =>
        again.frames.find(
          (f) =>
            (f.t === 'state' && (f.snapshot as { status?: string }).status === 'DONE') ||
            (f.t === 'settlement_update' && f.auctionState === 'SETTLED'),
        ),
      60_000,
      'settled after restart',
    );
    expect(final).toBeDefined();
    // A hammer retried after the restart is still a no-op, and settlement never ran twice.
    expect((await post(url2, path, hammer, auctioneerToken)).status).toBe(200);
    await sleep(500);
    const hammers = again.frames.filter((f) => f.t === 'hammer');
    expect(hammers.length).toBeLessThanOrEqual(1);
    const settled = again.frames.filter(
      (f) => f.t === 'settlement_update' && f.auctionState === 'SETTLED',
    );
    for (const f of settled) expect(f.amountCaptured).toBe(2000);
    expect((await fetch(`${url2}/healthz`)).status).toBe(200);
    expect(rejections).toEqual([]);
    expect(lines.filter((l) => l.includes('settlement stopped'))).toEqual([]);
  }, 120_000);
});
