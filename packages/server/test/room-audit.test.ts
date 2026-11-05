import type { BidMsg, EpochMs, MsgId } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { CONFIRM_TTL_MS } from '../src/room/confirm';
import { setup } from './room-harness';

const lowVoice = (mid: MsgId, amount: number): BidMsg => ({
  v: 1,
  t: 'bid',
  mid,
  amount,
  source: 'voice',
  confidence: 0.62,
});

describe('audit events for every room outcome (T-RT-030, R-RT-038)', () => {
  it('persists an audit for an accepted bid, a rejected bid, a confirm expiry and a control', async () => {
    const t = await setup();
    const c1 = await t.connect('bidder', t.b1);
    const c2 = await t.connect('bidder', t.b2);
    const boss = await t.connect('auctioneer');

    await t.room.submitBid(c1.conn, t.bid(12000));
    await t.room.submitBid(c2.conn, t.bid(100));
    await t.room.submitBid(c2.conn, lowVoice(t.ids.mint<'MsgId'>(), 20000));
    t.clock.set((t.clock.now() + CONFIRM_TTL_MS) as EpochMs);
    await t.connect('screen');
    await t.room.control(boss.conn, {
      controlId: 'audit-c1',
      action: 'hammer',
      args: { closeNow: 1 },
    });

    const events = await t.store.readEvents(t.auctionId, 1, 100);
    const audited = events.flatMap((e) =>
      'audit' in e && e.audit ? [{ type: e.type, audit: e.audit }] : [],
    );
    const pick = (type: string, outcome: string) =>
      audited.filter((a) => a.type === type && a.audit.outcome === outcome);

    expect(pick('bid_accepted', 'accepted')).toHaveLength(1);
    expect(pick('bid_rejected', 'rejected')).toHaveLength(1);
    expect(pick('confirm_resolved', 'expired')).toHaveLength(1);
    expect(pick('control', 'accepted')).toHaveLength(1);
  });
});
