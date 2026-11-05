import { GavelError, type AuctionId, type RoomEvent } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { FencedStore } from '../src/room/fence';
import { MemoryStore } from '../src/store/memory-store';
import { setup } from './room-harness';

const AUCTION = '01ARZ3NDEKTSV4RRFFQ69G5FAV' as AuctionId;

const event = (seq: number): RoomEvent =>
  ({ type: 'auction_created', auctionId: AUCTION, seq, ts: 1 }) as unknown as RoomEvent;

describe('T-RT-052 single-host fencing', () => {
  it('fences the second host on a stale expectedSeq and stops it serving', async () => {
    const shared = new MemoryStore();
    const fencedA: AuctionId[] = [];
    const fencedB: AuctionId[] = [];
    const hostA = new FencedStore(shared, { onFenced: (id) => fencedA.push(id) });
    const hostB = new FencedStore(shared, { onFenced: (id) => fencedB.push(id) });

    await hostA.appendEvents(AUCTION, 0, [event(1)]);
    await expect(hostB.appendEvents(AUCTION, 0, [event(1)])).rejects.toMatchObject({
      code: 'conflict',
    });
    expect(fencedB).toEqual([AUCTION]);
    expect(hostB.isFenced(AUCTION)).toBe(true);
    expect(fencedA).toEqual([]);

    await expect(hostB.appendEvents(AUCTION, 1, [event(2)])).rejects.toMatchObject({
      code: 'host_fenced',
    });
    expect(await shared.lastSeq(AUCTION)).toBe(1);
    expect(fencedB).toHaveLength(1);

    await hostA.appendEvents(AUCTION, 1, [event(2)]);
    expect(await shared.lastSeq(AUCTION)).toBe(2);
  });

  it('passes reads through and does not fence on other errors', async () => {
    const shared = new MemoryStore();
    const host = new FencedStore(shared, { onFenced: () => undefined });
    await host.appendEvents(AUCTION, 0, [event(1)]);
    expect(await host.lastSeq(AUCTION)).toBe(1);
    expect(host.isFenced(AUCTION)).toBe(false);
  });
});

describe('RT-94 room stops on an append conflict (R-RT-061)', () => {
  class ConflictStore extends MemoryStore {
    conflictNext = false;
    appended = 0;
    override async appendEvents(
      auctionId: AuctionId,
      expectedSeq: number,
      events: RoomEvent[],
    ): Promise<void> {
      if (this.conflictNext) throw new GavelError('conflict', 'stale expectedSeq');
      await super.appendEvents(auctionId, expectedSeq, events);
      this.appended += 1;
    }
  }

  it('fences the room, closes every transport with 4010 and refuses further commands', async () => {
    const store = new ConflictStore();
    const t = await setup({ store });
    const bidder = await t.connect('bidder', t.b1);
    const other = await t.connect('bidder', t.b2);
    const screen = await t.connect('screen');
    store.conflictNext = true;
    await t.room.submitBid(bidder.conn, t.bid(10000));

    expect(t.room.isStopped).toBe(true);
    expect(bidder.transport.messages('error').map((m) => m.code)).toContain('host_fenced');
    for (const c of [bidder, other, screen]) expect(c.transport.closed?.code).toBe(4010);

    store.conflictNext = false;
    const before = store.appended;
    await t.room.submitBid(other.conn, t.bid(10000));
    expect(store.appended).toBe(before);
    const late = await t.connect('bidder', t.b2);
    expect(late.transport.closed?.code).toBe(4010);
  });

  it('keeps serving when nothing conflicts', async () => {
    const store = new ConflictStore();
    const t = await setup({ store });
    const bidder = await t.connect('bidder', t.b1);
    await t.room.submitBid(bidder.conn, t.bid(10000));
    expect(t.room.isStopped).toBe(false);
    expect(bidder.transport.closed).toBeUndefined();
  });
});
