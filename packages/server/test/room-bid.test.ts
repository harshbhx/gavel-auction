import type { BidderId, Cents, ConnId, EpochMs } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { MemoryTransport } from '../src/room/memory-transport';
import { Room, type Connection } from '../src/room/room';
import { config, setup } from './room-harness';

describe('bid pipeline rejection codes (T-RT-027)', () => {
  it('maps each engine rejection to the same bid_rejected reason', async () => {
    const t = await setup();
    const c1 = await t.connect('bidder', t.b1);
    const c2 = await t.connect('bidder', t.b2);
    const reasons = (c: { transport: MemoryTransport }) =>
      c.transport.messages('bid_rejected').map((m) => m.reason);

    // Nothing leads yet, so anything under the reserve is below_reserve.
    await t.room.submitBid(c2.conn, t.bid(9000));
    // B1 takes the lead at the reserve.
    await t.room.submitBid(c1.conn, t.bid(10000));
    // B1 bids again while leading.
    await t.room.submitBid(c1.conn, t.bid(20000));
    // B2 is under the minimum increment, then above its own ceiling.
    await t.room.submitBid(c2.conn, t.bid(10100));
    await t.room.submitBid(c2.conn, t.bid(40000));
    // Not a whole number of cents.
    await t.room.submitBid(c2.conn, t.bid(10500.5));
    // A bidder token that never registered.
    const ghostId = t.ids.mint<'BidderId'>() as BidderId;
    const ghost = new MemoryTransport();
    const ghostConn: Connection = {
      id: t.ids.mint<'ConnId'>() as ConnId,
      role: 'bidder',
      sub: ghostId,
      bidderId: ghostId,
      transport: ghost,
    };
    await t.room.attach(ghostConn);
    await t.room.submitBid(ghostConn, t.bid(10500));
    // After the end time the room is closed.
    t.clock.set((config.endTs + 1) as EpochMs);
    await t.room.submitBid(c2.conn, t.bid(11000));

    expect(reasons(c2)).toEqual([
      'below_reserve',
      'below_increment',
      'over_ceiling',
      'bad_amount',
      'closed',
    ]);
    expect(reasons(c1)).toEqual(['already_leading']);
    expect(ghost.messages('bid_rejected').map((m) => m.reason)).toEqual(['unregistered']);
  });

  it('replays the same rejection for a repeated mid without a new event', async () => {
    const t = await setup();
    const c2 = await t.connect('bidder', t.b2);
    const mid = t.ids.mint<'MsgId'>();
    await t.room.submitBid(c2.conn, t.bid(9000 as Cents, mid));
    const before = await t.store.lastSeq(t.auctionId);
    await t.room.submitBid(c2.conn, t.bid(9000 as Cents, mid));
    const [first, second] = c2.transport.frames.filter((f) => f.includes('"bid_rejected"'));
    expect(second).toBe(first);
    expect(await t.store.lastSeq(t.auctionId)).toBe(before);
  });

  it('keeps the room usable after a restart for new bids', async () => {
    const t = await setup();
    const c1 = await t.connect('bidder', t.b1);
    await t.room.submitBid(c1.conn, t.bid(10000));
    const restarted = await Room.load(t.auctionId, t.deps);
    expect(restarted.lastSeq).toBe(t.room.lastSeq);
  });
});
