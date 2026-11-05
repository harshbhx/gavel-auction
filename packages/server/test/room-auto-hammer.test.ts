import {
  ManualClock,
  SeqIds,
  type AuctionConfig,
  type BidderId,
  type Cents,
  type ConnId,
  type EpochMs,
  type RoomEvent,
} from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { MemoryTransport } from '../src/room/memory-transport';
import { Room, type Connection } from '../src/room/room';
import { MemoryStore } from '../src/store/memory-store';
import { START, TestEngine, config } from './room-harness';

const build = async (autoHammerDelayMs: number) => {
  const clock = new ManualClock(START);
  const ids = new SeqIds();
  const store = new MemoryStore(() => clock.now());
  const cfg = { ...config, autoHammerDelayMs } as AuctionConfig;
  const auctionId = ids.mint<'AuctionId'>();
  const room = await Room.create(auctionId, cfg, 'auctioneer-sub', {
    store,
    clock,
    ids,
    engine: (c) => new TestEngine(c),
  });
  const b1 = ids.mint<'BidderId'>() as BidderId;
  await room.registerBidder({ bidderId: b1, name: 'Ada', ceiling: 50000 as Cents, holdRef: 'h1' });
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
  const hammers = async () =>
    (await store.readEvents(auctionId, 1, 1000)).filter((e: RoomEvent) => e.type === 'hammered');
  return { clock, ids, room, b1, connect, hammers };
};

describe('auto-hammer (R-RT-044, T-RT-035)', () => {
  it('hammers at CLOSING + autoHammerDelayMs', async () => {
    const t = await build(3000);
    const a = await t.connect('bidder', t.b1);
    await t.room.submitBid(a.conn, {
      v: 1,
      t: 'bid',
      mid: t.ids.mint<'MsgId'>(),
      amount: 10000,
      source: 'qr',
    });
    t.clock.set(config.endTs);
    await t.connect('screen');
    expect(await t.hammers()).toHaveLength(0);
    t.clock.set((config.endTs + 2999) as EpochMs);
    await t.connect('screen');
    expect(await t.hammers()).toHaveLength(0);
    t.clock.set((config.endTs + 3000) as EpochMs);
    await t.connect('screen');
    expect(await t.hammers()).toHaveLength(1);
  });

  it('skips the auto-hammer when the auctioneer hammered at +1000', async () => {
    const t = await build(3000);
    const boss = await t.connect('auctioneer');
    t.clock.set(config.endTs);
    await t.connect('screen');
    t.clock.set((config.endTs + 1000) as EpochMs);
    await t.room.control(boss.conn, { controlId: 'h1', action: 'hammer' });
    expect(await t.hammers()).toHaveLength(1);
    t.clock.set((config.endTs + 10_000) as EpochMs);
    await t.connect('screen');
    expect(await t.hammers()).toHaveLength(1);
  });
});
