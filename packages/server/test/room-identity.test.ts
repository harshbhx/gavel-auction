import { describe, expect, it } from 'vitest';
import { setup } from './room-harness';

describe('bidder identity (T-RT-031)', () => {
  it('ignores a spoofed bidderId from a bidder and honours the token', async () => {
    const t = await setup();
    const c1 = await t.connect('bidder', t.b1);
    await t.room.submitBid(c1.conn, { ...t.bid(10000), bidderId: t.b2 });
    const events = await t.store.readEvents(t.auctionId, 4, 1);
    expect(events[0]).toMatchObject({ type: 'bid_accepted', bidderId: t.b1 });
  });

  it('records source manual and the auctioneer sub for a manual bid', async () => {
    const t = await setup();
    const boss = await t.connect('auctioneer');
    await t.room.submitBid(boss.conn, { ...t.bid(10000), bidderId: t.b1 });
    const events = await t.store.readEvents(t.auctionId, 4, 1);
    expect(events[0]).toMatchObject({
      bidderId: t.b1,
      audit: { source: 'manual', transcript: `manual by ${boss.conn.sub}` },
    });
  });

  it('rejects a manual bid for a bidder that is not registered', async () => {
    const t = await setup();
    const boss = await t.connect('auctioneer');
    await t.room.submitBid(boss.conn, {
      ...t.bid(10000),
      bidderId: t.ids.mint<'BidderId'>(),
    });
    expect(boss.transport.messages('bid_rejected')).toMatchObject([{ reason: 'unregistered' }]);
  });
});
