import type { AuctionId, RoomEvent } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { FencedStore } from '../src/room/fence';
import { MemoryStore } from '../src/store/memory-store';

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
