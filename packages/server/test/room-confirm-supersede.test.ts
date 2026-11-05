import type { BidMsg, MsgId } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { setup } from './room-harness';

const lowVoice = (mid: MsgId, amount: number): BidMsg => ({
  v: 1,
  t: 'bid',
  mid,
  amount,
  source: 'voice',
  confidence: 0.62,
});

describe('supersede a pending confirmation (T-RT-038, R-RT-047)', () => {
  it('marks the first held bid superseded and leaves only the second pending', async () => {
    const t = await setup();
    const c1 = await t.connect('bidder', t.b1);
    await t.room.submitBid(c1.conn, lowVoice(t.ids.mint<'MsgId'>(), 12000));
    await t.room.submitBid(c1.conn, lowVoice(t.ids.mint<'MsgId'>(), 13000));

    const asks = c1.transport.messages('confirm_request');
    expect(asks).toHaveLength(2);
    const events = await t.store.readEvents(t.auctionId, 1, 100);
    const superseded = events.filter(
      (e) => e.type === 'confirm_resolved' && e.outcome === 'superseded',
    );
    expect(superseded).toHaveLength(1);
    expect(superseded[0]).toMatchObject({
      confirmId: String(asks[0]?.confirmId),
      audit: { outcome: 'superseded' },
    });

    // Only the second confirmation is still answerable, and it places the second amount.
    await t.room.respondConfirm(c1.conn, {
      v: 1,
      t: 'confirm_response',
      confirmId: String(asks[0]?.confirmId),
      accept: true,
    });
    expect(t.room.activeEngine?.view().price).toBeNull();
    await t.room.respondConfirm(c1.conn, {
      v: 1,
      t: 'confirm_response',
      confirmId: String(asks[1]?.confirmId),
      accept: true,
    });
    expect(t.room.activeEngine?.view().price).toBe(13000);
  });
});
