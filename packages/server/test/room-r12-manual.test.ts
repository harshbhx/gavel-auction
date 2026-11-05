import { describe, expect, it } from 'vitest';
import { setup } from './room-harness';

describe('manual bid replies (R12-S09)', () => {
  it('does not tell the auctioneer over_ceiling for a manual bid (R12-S09)', async () => {
    const t = await setup();
    const boss = await t.connect('auctioneer');
    // b2's ceiling is 30000; the auctioneer picks 40000 for them.
    await t.room.submitBid(boss.conn, { ...t.bid(40000), bidderId: t.b2 });
    const reply = boss.transport.messages('bid_rejected')[0];
    expect(reply).toBeDefined();
    expect(reply?.reason).not.toBe('over_ceiling');
    // Neither the live audit rows nor the reply name over_ceiling for a manual bid.
    for (const m of boss.transport.messages('audit_event')) {
      expect((m.audit as { reason?: string }).reason).not.toBe('over_ceiling');
    }
    // The own-bid reply to the bidder is unchanged.
    const c2 = await t.connect('bidder', t.b2);
    await t.room.submitBid(c2.conn, t.bid(40000));
    expect(c2.transport.messages('bid_rejected')[0]).toMatchObject({ reason: 'over_ceiling' });
  });

  it('limits a manual bid to the next increment (R12-S09)', async () => {
    const t = await setup();
    const boss = await t.connect('auctioneer');
    // b1's ceiling is 50000, so before the fix 20000 was accepted and bound the bidder to it.
    await t.room.submitBid(boss.conn, { ...t.bid(20000), bidderId: t.b1 });
    expect(boss.transport.messages('bid_accepted')).toHaveLength(0);
    expect(boss.transport.messages('bid_rejected')[0]).toMatchObject({ reason: 'limit_exceeded' });
    // The next increment itself is still accepted.
    await t.room.submitBid(boss.conn, { ...t.bid(10000), bidderId: t.b1 });
    expect(boss.transport.messages('bid_accepted')).toHaveLength(1);
  });
});
