import type { BidderId, RoomEvent } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CAPS } from '../src/limits/caps';
import { setup } from './room-harness';

const types = (evs: RoomEvent[]) => evs.map((e) => e.type);

describe('rejected bids are bounded (R12-S05)', () => {
  it('answers an unregistered or malformed bid without logging it or using a seq', async () => {
    const t = await setup();
    const ghostId = t.ids.mint<'BidderId'>() as BidderId;
    const ghost = await t.connect('bidder', ghostId);
    const watcher = await t.connect('screen');
    const before = await t.store.lastSeq(t.auctionId);
    for (let i = 0; i < 5; i++) await t.room.submitBid(ghost.conn, t.bid(10000));
    const c1 = await t.connect('bidder', t.b1);
    await t.room.submitBid(c1.conn, t.bid(350.5));
    expect(ghost.transport.messages('bid_rejected')).toHaveLength(5);
    expect(c1.transport.messages('bid_rejected')[0]).toMatchObject({ reason: 'bad_amount' });
    expect(await t.store.lastSeq(t.auctionId)).toBe(before);
    expect(types(await t.store.readEvents(t.auctionId, 1, 100))).not.toContain('bid_rejected');
    // nothing was fanned out to the other viewers
    expect(watcher.transport.messages('audit_event')).toHaveLength(0);
  });

  it('stops logging rejected bids at the per-auction cap', async () => {
    const t = await setup({ caps: { ...DEFAULT_CAPS, bidsPerAuction: 2 } });
    const c2 = await t.connect('bidder', t.b2);
    for (let i = 0; i < 5; i++) await t.room.submitBid(c2.conn, t.bid(100));
    const logged = (await t.store.readEvents(t.auctionId, 1, 100)).filter(
      (e) => e.type === 'bid_rejected',
    );
    expect(logged).toHaveLength(2);
    expect(c2.transport.messages('bid_rejected')).toHaveLength(5);
  });
});
