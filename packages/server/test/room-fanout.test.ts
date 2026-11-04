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
    const c1Before = c1.transport.frames.length;
    const screenBefore = screen.transport.frames.length;
    await t.room.submitBid(c2.conn, t.bid(40000));
    const rejected = c2.transport.messages('bid_rejected');
    expect(rejected).toMatchObject([{ reason: 'over_ceiling' }]);
    expect(rejected[0]).toHaveProperty('retryable');
    // The rejected bid still takes a seq, so each other connection gets exactly one frame that keeps
    // its seq gap-free (R-RT-036) and never carries the rejection itself.
    for (const [c, from] of [
      [c1, c1Before],
      [screen, screenBefore],
    ] as const) {
      expect(c.transport.messages().slice(from)).toHaveLength(1);
      expect(c.transport.messages('bid_rejected')).toHaveLength(0);
    }
  });
});
