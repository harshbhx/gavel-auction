import { describe, expect, it } from 'vitest';
import { setup } from './room-harness';

describe('accept fan-out (T-RT-028)', () => {
  it('sends bid_accepted to the sender and price to every connection with one seq', async () => {
    const t = await setup();
    const c1 = await t.connect('bidder', t.b1);
    const c2 = await t.connect('bidder', t.b2);
    const screen = await t.connect('screen');
    await t.room.submitBid(c1.conn, t.bid(35000));
    const accepted = c1.transport.messages('bid_accepted');
    expect(accepted).toHaveLength(1);
    const seq = accepted[0]?.seq;
    for (const c of [c1, c2, screen]) {
      expect(c.transport.messages('price')).toMatchObject([
        { price: 35000, leaderId: t.b1, minNext: 35500, seq },
      ]);
    }
    expect(c2.transport.messages('bid_accepted')).toHaveLength(0);
  });
});

describe('reject fan-out (T-RT-029)', () => {
  it('sends a rejection to the sender only and nothing to the others', async () => {
    const t = await setup();
    const c1 = await t.connect('bidder', t.b1);
    const c2 = await t.connect('bidder', t.b2);
    const screen = await t.connect('screen');
    const before = [c1, screen].map((c) => c.transport.frames.length);
    await t.room.submitBid(c2.conn, t.bid(40000));
    const rejected = c2.transport.messages('bid_rejected');
    expect(rejected).toMatchObject([{ reason: 'over_ceiling' }]);
    expect(rejected[0]).toHaveProperty('retryable');
    expect([c1, screen].map((c) => c.transport.frames.length)).toEqual(before);
  });
});
