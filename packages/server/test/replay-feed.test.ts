import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  ManualClock,
  UlidMinter,
  type AuctionId,
  type EpochMs,
  type RoomEvent,
  type RoomStore,
} from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { createExportHandler, exportLines } from '../src/http/export';
import { ReplayFeed } from '../src/room/replay-feed';

const T0 = 1_789_000_000_000;
const ids = new UlidMinter(new ManualClock(T0));
const auctionId = ids.mint<'AuctionId'>();
const bidderId = ids.mint<'BidderId'>();

function ev(seq: number, at: number, extra: Record<string, unknown>): RoomEvent {
  return { type: 'settle_requested', auctionId, seq, ts: at as EpochMs, ...extra } as RoomEvent;
}

const log: RoomEvent[] = [
  ev(1, T0, { type: 'auction_created', auctionId, auctioneerSub: 'sub-1', config: {} }),
  ev(2, T0 + 400, {
    type: 'bidder_registered',
    bidderId,
    paddle: 1,
    name: 'Fake Name',
    ceiling: 7654321,
    holdRef: 'hold-ref',
  }),
  ev(3, T0 + 1200, { type: 'settle_requested' }),
];

const store: Pick<RoomStore, 'readEvents'> = {
  readEvents: async (_id, from, limit) => log.filter((e) => e.seq >= from).slice(0, limit),
};

describe('ReplayFeed (T-RT-080)', () => {
  it('emits at original deltas divided by 4 through a ManualClock', () => {
    const clock = new ManualClock(5_000);
    const out: Array<{ seq: number; at: number }> = [];
    let ended = false;
    const feed = new ReplayFeed({
      events: log,
      clock,
      speed: 4,
      emit: (e) => out.push({ seq: e.seq, at: clock.now() }),
      onEnd: () => {
        ended = true;
      },
    });
    feed.start();
    expect(out).toEqual([{ seq: 1, at: 5_000 }]);
    clock.advance(99);
    expect(out).toHaveLength(1);
    clock.advance(1);
    expect(out.map((o) => o.at)).toEqual([5_000, 5_100]);
    clock.advance(10_000);
    expect(out.map((o) => o.seq)).toEqual([1, 2, 3]);
    expect(ended).toBe(true);
  });

  it('keeps the original spacing at 1x and can be stopped', () => {
    const clock = new ManualClock(0);
    const seen: number[] = [];
    const feed = new ReplayFeed({ events: log, clock, speed: 1, emit: (e) => seen.push(e.seq) });
    feed.start();
    clock.advance(400);
    feed.stop();
    clock.advance(5_000);
    expect(seen).toEqual([1, 2]);
  });

  it('rejects speeds outside 1..16', () => {
    const clock = new ManualClock(0);
    for (const speed of [0, 0.5, 17, Number.NaN]) {
      expect(() => new ReplayFeed({ events: log, clock, speed, emit: () => {} })).toThrow(
        RangeError,
      );
    }
  });
});

describe('export (T-RT-080)', () => {
  it('admin export equals the log, one JSON object per line', async () => {
    const lines: string[] = [];
    for await (const l of exportLines(store, auctionId, 'admin')) lines.push(l);
    expect(lines.every((l) => l.endsWith('\n'))).toBe(true);
    expect(lines.map((l) => JSON.parse(l) as unknown)).toEqual(JSON.parse(JSON.stringify(log)));
  });

  it('auctioneer export drops ceilings and personal fields', async () => {
    const text: string[] = [];
    for await (const l of exportLines(store, auctionId, 'auctioneer')) text.push(l);
    const all = text.join('');
    expect(all).not.toContain('7654321');
    expect(all).not.toContain('Fake Name');
    expect(all).not.toContain('hold-ref');
    expect(all).not.toContain('sub-1');
  });

  function run(url: string, role: Parameters<typeof makeAuth>[0]) {
    const out = { status: 0, body: '' };
    const req = { method: 'GET', url, headers: {} } as unknown as IncomingMessage;
    const res = {
      setHeader() {},
      writeHead(s: number) {
        out.status = s;
      },
      write(t: string) {
        out.body += t;
        return true;
      },
      end(t?: string) {
        if (t) out.body += t;
      },
    } as unknown as ServerResponse;
    const handler = createExportHandler({ store, authenticate: makeAuth(role) });
    return handler(req, res).then(() => out);
  }

  function makeAuth(role: 'admin' | 'auctioneer' | 'bidder' | undefined) {
    return async () => role;
  }

  it('streams NDJSON for allowed roles and refuses the rest', async () => {
    const ok = await run(`/api/auctions/${auctionId}/export`, 'auctioneer');
    expect(ok.status).toBe(200);
    expect(ok.body.trim().split('\n')).toHaveLength(3);
    expect((await run(`/api/auctions/${auctionId}/export`, undefined)).status).toBe(401);
    expect((await run(`/api/auctions/${auctionId}/export`, 'bidder')).status).toBe(403);
    expect((await run('/api/auctions/x/other', 'admin')).status).toBe(404);
  });

  it('answers 404 for an auction with no events', async () => {
    const empty = createExportHandler({
      store: { readEvents: async () => [] },
      authenticate: async () => 'admin',
    });
    const out = { status: 0 };
    await empty(
      {
        method: 'GET',
        url: `/api/auctions/${auctionId as AuctionId}/export`,
        headers: {},
      } as never,
      {
        setHeader() {},
        writeHead(s: number) {
          out.status = s;
        },
        end() {},
      } as never,
    );
    expect(out.status).toBe(404);
  });
});
