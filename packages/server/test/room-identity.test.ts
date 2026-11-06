import { describe, expect, it } from 'vitest';
import { acceptLatestConfirm, setup } from './room-harness';

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
    const c1 = await t.connect('bidder', t.b1);
    await t.room.submitBid(boss.conn, { ...t.bid(10000), bidderId: t.b1 });
    await acceptLatestConfirm(t.room, c1);
    const events = (await t.store.readEvents(t.auctionId, 4, 10)).filter(
      (e) => e.type === 'bid_accepted',
    );
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

  it('records the connection role as the event source, not the frame claim (R6-D05)', async () => {
    const t = await setup();
    const c1 = await t.connect('bidder', t.b1);
    await t.room.submitBid(c1.conn, { ...t.bid(10000), source: 'manual' });
    const boss = await t.connect('auctioneer');
    t.clock.set(t.clock.now() + 1000);
    const c2 = await t.connect('bidder', t.b2);
    await t.room.submitBid(boss.conn, { ...t.bid(10500), bidderId: t.b2, source: 'qr' });
    await acceptLatestConfirm(t.room, c2);
    const events = (await t.store.readEvents(t.auctionId, 4, 10)).filter(
      (e) => e.type === 'bid_accepted',
    );
    expect(events[0]).toMatchObject({ source: 'qr', audit: { source: 'qr' } });
    expect(events[1]).toMatchObject({ source: 'manual', audit: { source: 'manual' } });
  });

  it('refuses a second hold for a bidder whose ceiling was revoked (R6-D02)', async () => {
    const t = await setup();
    // The test engine cannot revoke, so mark the ceiling as the room does after a revoke.
    (t.room as unknown as { revoked: Set<string> }).revoked.add(t.b1);
    await expect(
      t.room.registerBidder({
        bidderId: t.b1,
        name: 'Ada',
        ceiling: 50000 as never,
        holdRef: 'h7',
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });
});
