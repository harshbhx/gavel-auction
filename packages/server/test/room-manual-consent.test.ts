import { describe, expect, it } from 'vitest';
import { MAX_MANUAL_BIDS_PER_LOT, Room } from '../src/room/room';
import { acceptLatestConfirm, setup } from './room-harness';

describe('manual bids need the bidder to confirm (#1751)', () => {
  it('places nothing until the named bidder answers, then records a confirmed manual bid', async () => {
    const t = await setup();
    const boss = await t.connect('auctioneer');
    const c1 = await t.connect('bidder', t.b1);
    await t.room.submitBid(boss.conn, { ...t.bid(10000), bidderId: t.b1 });
    expect(c1.transport.messages('confirm_request')).toHaveLength(1);
    expect(t.room.activeEngine?.view().price).toBeNull();
    const before = await t.store.readEvents(t.auctionId, 1, 100);
    expect(before.some((e) => e.type === 'bid_accepted')).toBe(false);

    await acceptLatestConfirm(t.room, c1);
    const accepted = (await t.store.readEvents(t.auctionId, 1, 100)).find(
      (e) => e.type === 'bid_accepted',
    );
    expect(accepted).toMatchObject({
      bidderId: t.b1,
      source: 'manual',
      audit: { source: 'manual', confirmed: true, transcript: `manual by ${boss.conn.sub}` },
    });
    expect(t.room.activeEngine?.view().price).toBe(10000);
  });

  it('places no bid when the bidder refuses or is not connected', async () => {
    const t = await setup();
    const boss = await t.connect('auctioneer');
    const c2 = await t.connect('bidder', t.b2);
    await t.room.submitBid(boss.conn, { ...t.bid(10000), bidderId: t.b2 });
    const confirmId = String(c2.transport.messages('confirm_request')[0]?.confirmId);
    await t.room.respondConfirm(c2.conn, { v: 1, t: 'confirm_response', confirmId, accept: false });
    expect(t.room.activeEngine?.view().price).toBeNull();
    // Nobody can answer for a bidder who is offline: the bid stays unplaced.
    await t.room.submitBid(boss.conn, { ...t.bid(10000), bidderId: t.b1 });
    expect(t.room.activeEngine?.view().price).toBeNull();
  });

  it('refuses another bidder answering for the named one', async () => {
    const t = await setup();
    const boss = await t.connect('auctioneer');
    const c1 = await t.connect('bidder', t.b1);
    const c2 = await t.connect('bidder', t.b2);
    await t.room.submitBid(boss.conn, { ...t.bid(10000), bidderId: t.b1 });
    const confirmId = String(c1.transport.messages('confirm_request')[0]?.confirmId);
    await t.room.respondConfirm(c2.conn, { v: 1, t: 'confirm_response', confirmId, accept: true });
    expect(t.room.activeEngine?.view().price).toBeNull();
  });

  it('keeps the held manual bid across a restart and still records it as manual', async () => {
    const t = await setup();
    const boss = await t.connect('auctioneer');
    const c1 = await t.connect('bidder', t.b1);
    await t.room.submitBid(boss.conn, { ...t.bid(10000), bidderId: t.b1 });
    const confirmId = String(c1.transport.messages('confirm_request')[0]?.confirmId);
    const reborn = await Room.load(t.auctionId, t.deps);
    const c1b = await t.connect('bidder', t.b1);
    await reborn.attach(c1b.conn);
    await reborn.respondConfirm(c1b.conn, {
      v: 1,
      t: 'confirm_response',
      confirmId,
      accept: true,
    });
    const accepted = (await t.store.readEvents(t.auctionId, 1, 100)).find(
      (e) => e.type === 'bid_accepted',
    );
    expect(accepted).toMatchObject({ source: 'manual', audit: { confirmed: true } });
  });

  it('caps the manual bids one auctioneer may enter in a lot', async () => {
    const t = await setup();
    const boss = await t.connect('auctioneer');
    await t.connect('bidder', t.b1);
    for (let i = 0; i < MAX_MANUAL_BIDS_PER_LOT; i += 1) {
      await t.room.submitBid(boss.conn, { ...t.bid(10000), bidderId: t.b1 });
    }
    const asked = (await t.store.readEvents(t.auctionId, 1, 1000)).filter(
      (e) => e.type === 'confirm_requested',
    );
    expect(asked).toHaveLength(MAX_MANUAL_BIDS_PER_LOT);
    await t.room.submitBid(boss.conn, { ...t.bid(10000), bidderId: t.b1 });
    expect(boss.transport.messages('error').at(-1)).toMatchObject({ code: 'limit_exceeded' });
    const after = (await t.store.readEvents(t.auctionId, 1, 1000)).filter(
      (e) => e.type === 'confirm_requested',
    );
    expect(after).toHaveLength(MAX_MANUAL_BIDS_PER_LOT);
    // A second socket of the same token does not reset the count, also after a reload.
    const reloaded = await Room.load(t.auctionId, t.deps);
    const again = await t.connect('auctioneer');
    await reloaded.attach(again.conn);
    await reloaded.submitBid(again.conn, { ...t.bid(10000), bidderId: t.b1 });
    expect(again.transport.messages('error').at(-1)).toMatchObject({ code: 'limit_exceeded' });
  });
});
