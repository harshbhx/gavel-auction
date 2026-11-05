import type { Cents } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CAPS } from '../src/limits/caps';
import { SUPERSEDED_CODE } from '../src/room/resync';
import { setup } from './room-harness';

describe('room enforces the configured caps (R-RT-058, R-RT-062)', () => {
  it('refuses a connection beyond MAX_CONN_PER_ROOM with room_full', async () => {
    const t = await setup({ caps: { ...DEFAULT_CAPS, connectionsPerRoom: 2 } });
    await t.connect('screen');
    await t.connect('screen');
    const third = await t.connect('auctioneer');
    expect(third.transport.messages('error').map((m) => m.code)).toEqual(['room_full']);
    expect(third.transport.closed?.code).toBe(4009);
    expect(t.room.connectionCount).toBe(2);
  });

  it('supersedes the oldest connection past MAX_CONN_PER_BIDDER', async () => {
    const t = await setup({ caps: { ...DEFAULT_CAPS, connectionsPerBidder: 2 } });
    const first = await t.connect('bidder', t.b1);
    await t.connect('bidder', t.b1);
    const third = await t.connect('bidder', t.b1);
    expect(first.transport.closed?.code).toBe(SUPERSEDED_CODE);
    expect(third.transport.closed).toBeUndefined();
    expect(t.room.connectionCount).toBe(2);
  });

  it('answers auction_full once MAX_BIDS_PER_AUCTION bids are in the log', async () => {
    const t = await setup({ caps: { ...DEFAULT_CAPS, bidsPerAuction: 2 } });
    const c1 = await t.connect('bidder', t.b1);
    await t.room.submitBid(c1.conn, t.bid(10000));
    await t.room.submitBid(c1.conn, t.bid(10100));
    const seq = t.room.lastSeq;
    await t.room.submitBid(c1.conn, t.bid(20000));
    expect(c1.transport.messages('error').map((m) => m.code)).toEqual(['auction_full']);
    expect(t.room.lastSeq).toBe(seq);
  });

  it('caps the roster at MAX_BIDDERS_PER_ROOM', async () => {
    const t = await setup({ caps: { ...DEFAULT_CAPS, biddersPerRoom: 2 } });
    await expect(
      t.room.registerBidder({
        bidderId: t.ids.mint<'BidderId'>(),
        name: 'Cy',
        ceiling: 20000 as Cents,
        holdRef: 'h3',
      }),
    ).rejects.toMatchObject({ code: 'room_full' });
  });
});
