import {
  ManualClock,
  SeqIds,
  type AuctionConfig,
  type BidderId,
  type Cents,
  type ConnId,
  type EpochMs,
  type MsgId,
} from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { MemoryTransport } from '../src/room/memory-transport';
import { Room, type Connection } from '../src/room/room';
import { LedgerEngine } from '../src/runtime/ledger-engine';
import { MemoryStore } from '../src/store/memory-store';

const START = 1_789_000_000_000;

const config = {
  mode: 'english',
  currency: 'USD',
  reserve: 10000,
  minIncrement: 500,
  endTs: START + 10_000,
  softCloseWindowMs: 5000,
  softCloseExtensionMs: 10_000,
  maxExtensions: 2,
  ceilingPresets: [50000],
  confirmConfidenceThreshold: 0.85,
} as unknown as AuctionConfig;

const build = async () => {
  const clock = new ManualClock(START);
  const ids = new SeqIds();
  const store = new MemoryStore(() => clock.now());
  const auctionId = ids.mint<'AuctionId'>();
  const room = await Room.create(auctionId, config, 'auctioneer-sub', {
    store,
    clock,
    ids,
    engine: (cfg, createdAt) => new LedgerEngine(auctionId, cfg, createdAt),
  });
  const b1 = ids.mint<'BidderId'>() as BidderId;
  const b2 = ids.mint<'BidderId'>() as BidderId;
  await room.registerBidder({ bidderId: b1, name: 'Ada', ceiling: 50000 as Cents, holdRef: 'h1' });
  await room.registerBidder({ bidderId: b2, name: 'Bo', ceiling: 50000 as Cents, holdRef: 'h2' });
  const connect = async (role: Connection['role'], bidderId?: BidderId) => {
    const transport = new MemoryTransport();
    const conn: Connection = {
      id: ids.mint<'ConnId'>() as ConnId,
      role,
      sub: bidderId ?? `${role}-sub`,
      transport,
      ...(bidderId ? { bidderId } : {}),
    };
    await room.attach(conn);
    return { conn, transport };
  };
  const bidAt = async (who: Connection, at: number, amount: number) => {
    clock.set(at);
    await room.submitBid(who, {
      v: 1,
      t: 'bid',
      mid: ids.mint<'MsgId'>() as MsgId,
      amount,
      source: 'qr',
    });
  };
  const flush = async () => {
    await connect('screen');
  };
  return { clock, store, auctionId, room, b1, b2, connect, bidAt, flush };
};

describe('soft-close extension in frames and timers (T-RT-033)', () => {
  it('moves endTs in the same price frame, re-arms the timer and stops at maxExtensions', async () => {
    const t = await build();
    const a = await t.connect('bidder', t.b1);
    const b = await t.connect('bidder', t.b2);
    const screen = await t.connect('screen');
    const prices = () => screen.transport.messages('price');

    // A bid at 8000 is inside the 5000 window: the end moves to 8000 + 10000.
    await t.bidAt(a.conn, START + 8000, 10000);
    expect(prices().at(-1)).toMatchObject({ price: 10000, endTs: START + 18_000, extensions: 1 });

    // The old end passes without the room closing; the timer follows the new end.
    t.clock.set(START + 10_000);
    await t.flush();
    expect(t.room.activeEngine?.view().state).toBe('OPEN');
    const types = async () => (await t.store.readEvents(t.auctionId, 1, 100)).map((e) => e.type);
    expect(await types()).not.toContain('state_changed');

    await t.bidAt(b.conn, START + 16_000, 10500);
    expect(prices().at(-1)).toMatchObject({ endTs: START + 26_000, extensions: 2 });

    // maxExtensions = 2: a third bid inside the window does not move the end.
    await t.bidAt(a.conn, START + 24_000, 11000);
    expect(prices().at(-1)).toMatchObject({ price: 11000, endTs: START + 26_000, extensions: 2 });

    t.clock.set((START + 26_000) as EpochMs);
    await t.flush();
    expect(t.room.activeEngine?.view().state).toBe('CLOSING');
  });
});
