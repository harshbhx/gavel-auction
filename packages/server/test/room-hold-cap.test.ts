import type { BidMsg, MsgId } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { setup } from './room-harness';

const ambiguous = (mid: MsgId, amount: number): BidMsg => ({
  v: 1,
  t: 'bid',
  mid,
  amount,
  source: 'voice',
  ambiguous: true,
});

describe('held voice bids spend a bounded budget (RT4-sec-03)', () => {
  it('keeps the log bounded under 1000 ambiguous frames from one bidder', async () => {
    const t = await setup();
    const c = await t.connect('bidder', t.b1);
    for (let i = 0; i < 1000; i += 1) {
      await t.room.submitBid(c.conn, ambiguous(t.ids.mint<'MsgId'>(), 12000));
    }
    const events = await t.store.readEvents(t.auctionId, 1, 5000);
    expect(events.length).toBeLessThan(150);
  });

  it('does not hold an amount below the next price', async () => {
    const t = await setup();
    const c = await t.connect('bidder', t.b1);
    await t.room.submitBid(c.conn, ambiguous(t.ids.mint<'MsgId'>(), 1));
    const events = await t.store.readEvents(t.auctionId, 1, 100);
    expect(events.some((e) => e.type === 'confirm_requested')).toBe(false);
  });
});
