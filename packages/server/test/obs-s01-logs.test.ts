import { SystemClock } from '@gavel/shared';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { composeServer, type Composed } from '../src/boot/compose';

// T-QA-081 (R-QA-047): the log schema over a whole happy path, not only a probe. Two bidders whose
// names are email addresses join a room, hold, bid, and the lot is hammered and settled on the fake
// PayPal. Every line the server wrote must parse with the schema keys and hold no full email, and
// the operator routes must show the lot's saga state, the bid counters and at most 100 log lines.

const ORIGIN = 'http://localhost:8080';
const KEY = 'test-admin-key-test-admin-key';
const base = {
  PUBLIC_URL: ORIGIN,
  TOKEN_SECRET: 'test-secret-test-secret-test-secret-0123',
  ADMIN_KEY: KEY,
  PAYMENTS: 'fake',
  LOG_LEVEL: 'debug',
  JUDGE_ROOMS: 'true',
};
const json = { 'content-type': 'application/json' };
const FULL_EMAIL = /[A-Za-z0-9._%+-]{2,}@[A-Za-z0-9-]{2,}\.[A-Za-z]{2,}/;
const NAMES = ['ada.bidder@example.com', 'cy.bidder@example.org'];

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

describe('T-QA-081 log schema over a settled happy path (R-QA-047)', () => {
  it('every line parses with the schema keys, holds no full email, and /ops shows the lot', async () => {
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

    const tokens: string[] = [];
    for (const name of NAMES) {
      const joined = await post('/api/judge/join', { code: joinCode, displayName: name });
      expect(joined.status).toBe(200);
      const token = joined.body.sessionToken as string;
      const hold = await post(
        `/api/judge/rooms/${auctionId}/sim-hold`,
        { ceilingCents: 5000, name },
        token,
      );
      expect(hold.status).toBe(200);
      tokens.push(token);
    }

    // The room may already be open; either answer leaves the lot open.
    await post(
      `/api/auctions/${auctionId}/control`,
      { controlId: 'open-1', action: 'open' },
      auctioneerToken,
    );

    const conns = [];
    for (const token of tokens) conns.push(await open(port, token, auctionId));
    await Promise.all(
      conns.map((c) => until(() => c.frames.find((f) => f.t === 'state'), 5000, 'state')),
    );
    for (const [who, amount] of [
      [0, 1500],
      [1, 2000],
    ] as const) {
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

    const hammer = await post(
      `/api/auctions/${auctionId}/control`,
      { controlId: 'hammer-1', action: 'hammer', args: { closeNow: 1 } },
      auctioneerToken,
    );
    expect(hammer.status).toBe(200);
    const final = await until(
      () =>
        conns
          .flatMap((c) => c.frames)
          .find(
            (f) =>
              f.t === 'settlement_update' &&
              (f.auctionState === 'SETTLED' || f.auctionState === 'FAILED_NEEDS_REVIEW'),
          ),
      60_000,
      'terminal settlement',
    );
    expect(final.auctionState).toBe('SETTLED');

    // The operator routes, read before the log lines are checked so their own lines count too.
    const headers = { 'x-admin-key': KEY };
    const summary = (await (await fetch(`${url}/ops/summary`, { headers })).json()) as {
      logs: string[];
      sagas: Array<{ auctionId: string; lotId: string; state: string }>;
    };
    const prom = await (await fetch(`${url}/metrics/prometheus`, { headers })).text();

    // Every line of the run: JSON with the schema keys, and no full email address.
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const rec = JSON.parse(line) as Record<string, unknown>;
      expect(typeof rec['ts'], line).toBe('number');
      expect(['debug', 'info', 'warn', 'error'], line).toContain(rec['level']);
      expect(typeof rec['msg'], line).toBe('string');
      expect(typeof rec['context'], line).toBe('object');
      expect(line).not.toMatch(FULL_EMAIL);
    }

    // The ops view: at most 100 lines, none with a full email, and the saga state of the lot.
    expect(summary.logs.length).toBeGreaterThan(0);
    expect(summary.logs.length).toBeLessThanOrEqual(100);
    for (const line of summary.logs) expect(line).not.toMatch(FULL_EMAIL);
    const row = summary.sagas.find((s) => s.auctionId === auctionId);
    expect(row).toBeDefined();
    expect(typeof row?.state).toBe('string');

    // The metrics of the run: two accepted bids and the saga of the lot.
    expect(prom).toContain('gavel_bids_total{result="accepted"} 2');
    expect(prom).toMatch(/gavel_saga_lots\{state="[A-Z_]+"\} 1/);
    expect(prom).toMatch(/gavel_saga_transitions_total\{state="[A-Z_]+"\} \d+/);
  }, 90_000);
});
