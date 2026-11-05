import type { AuctionId, RoomEvent } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/store/memory-store';
import { SpyStore, setup } from './room-harness';

describe('write-ahead ordering (T-RT-024)', () => {
  it('appends each seq to the store before any send for that seq in 100 bid runs', async () => {
    const log: string[] = [];
    const store = new SpyStore(log);
    const t = await setup({ store });
    const c1 = await t.connect('bidder', t.b1);
    const c2 = await t.connect('bidder', t.b2);
    for (const c of [c1, c2]) {
      const original = c.transport.send.bind(c.transport);
      c.transport.send = (text: string) => {
        const seq = (JSON.parse(text) as { seq?: number }).seq;
        if (seq !== undefined) log.push(`send:${seq}`);
        original(text);
      };
    }
    log.length = 0;
    // Small linear congruential generator keeps the run reproducible.
    let state = 12345;
    const next = (): number => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state;
    };
    let amount = 10000;
    for (let i = 0; i < 100; i++) {
      const bidder = next() % 2 === 0 ? c1 : c2;
      amount += 500 * (1 + (next() % 3));
      await t.room.submitBid(bidder.conn, t.bid(amount));
    }
    const appended = new Set<number>();
    for (const entry of log) {
      const [kind, raw] = entry.split(':');
      const seq = Number(raw);
      if (kind === 'append') appended.add(seq);
      else expect(appended.has(seq)).toBe(true);
    }
    expect(appended.size).toBeGreaterThan(0);
  });
});

class FailFirst extends MemoryStore {
  calls = 0;
  armed = false;
  override async appendEvents(
    auctionId: AuctionId,
    expectedSeq: number,
    events: RoomEvent[],
  ): Promise<void> {
    if (this.armed) {
      this.armed = false;
      this.calls += 1;
      throw new Error('disk full');
    }
    return super.appendEvents(auctionId, expectedSeq, events);
  }
}

describe('store failure (T-RT-025)', () => {
  it('tells only the sender, keeps seq, then accepts the next bid at seq + 1', async () => {
    const store = new FailFirst();
    const t = await setup({ store });
    const c1 = await t.connect('bidder', t.b1);
    const c2 = await t.connect('bidder', t.b2);
    const screen = await t.connect('screen');
    const before = await store.lastSeq(t.auctionId);
    const othersBefore = [c2, screen].map((c) => c.transport.frames.length);
    store.armed = true;
    await t.room.submitBid(c1.conn, t.bid(10000));
    expect(c1.transport.messages('error')).toMatchObject([{ code: 'store_unavailable' }]);
    expect([c2, screen].map((c) => c.transport.frames.length)).toEqual(othersBefore);
    expect(await store.lastSeq(t.auctionId)).toBe(before);
    await t.room.submitBid(c1.conn, t.bid(10000));
    expect(c1.transport.messages('bid_accepted')).toMatchObject([{ seq: before + 1 }]);
  });
});
