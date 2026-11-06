import type { BidMsg, MsgId } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { acceptLatestConfirm, setup } from './room-harness';

const spoken = (mid: MsgId, amount: number, extra: Partial<BidMsg> = {}): BidMsg => ({
  v: 1,
  t: 'bid',
  mid,
  amount,
  source: 'voice',
  transcript: 'paddle one twelve thousand',
  ...extra,
});

describe('Room voice port (HRD-67)', () => {
  it('shows paddles and prices but no ceilings', async () => {
    const t = await setup();
    const view = t.room.voiceView();
    expect(view).toMatchObject({ open: true, minIncrement: 500, confirmThreshold: 0.85 });
    expect(view?.roster).toEqual([
      { bidderId: t.b1, paddle: '1' },
      { bidderId: t.b2, paddle: '2' },
    ]);
    expect(JSON.stringify(view)).not.toContain('50000');
  });

  it('places a confident spoken bid for the named bidder and records it as voice', async () => {
    const t = await setup();
    await t.room.submitVoiceBid(t.b1, spoken(t.ids.mint<'MsgId'>(), 12000, { confidence: 0.95 }));
    expect(t.room.activeEngine?.view().price).toBe(12000);
    expect(t.room.activeEngine?.view().leader).toBe(t.b1);
    const events = await t.store.readEvents(t.auctionId, 1, 100);
    expect(JSON.stringify(events)).toContain('"source":"voice"');
  });

  it('holds a low confidence or ambiguous spoken bid until its bidder answers', async () => {
    const t = await setup();
    const bidder = await t.connect('bidder', t.b1);
    await t.room.submitVoiceBid(
      t.b1,
      spoken(t.ids.mint<'MsgId'>(), 12000, { confidence: 0.6, ambiguous: true }),
    );
    expect(bidder.transport.messages('confirm_request')).toHaveLength(1);
    expect(t.room.activeEngine?.view().price).toBeNull();
    await acceptLatestConfirm(t.room, bidder);
    expect(t.room.activeEngine?.view().price).toBe(12000);
  });

  it('treats a source label other than voice as voice, so the gate cannot be skipped', async () => {
    const t = await setup();
    const bidder = await t.connect('bidder', t.b1);
    await t.room.submitVoiceBid(t.b1, { ...spoken(t.ids.mint<'MsgId'>(), 12000), source: 'qr' });
    expect(bidder.transport.messages('confirm_request')).toHaveLength(1);
    expect(t.room.activeEngine?.view().price).toBeNull();
  });

  it('answers a repeated message id once (stream idempotency)', async () => {
    const t = await setup();
    const mid = t.ids.mint<'MsgId'>();
    await t.room.submitVoiceBid(t.b1, spoken(mid, 12000, { confidence: 0.95 }));
    await t.room.submitVoiceBid(t.b1, spoken(mid, 12000, { confidence: 0.95 }));
    const events = await t.store.readEvents(t.auctionId, 1, 100);
    expect(events.filter((e) => e.type === 'bid_accepted')).toHaveLength(1);
  });

  it('refuses a spoken bid for an unregistered bidder', async () => {
    const t = await setup();
    const stranger = t.ids.mint<'BidderId'>();
    await t.room.submitVoiceBid(
      stranger,
      spoken(t.ids.mint<'MsgId'>(), 12000, { confidence: 0.95 }),
    );
    expect(t.room.activeEngine?.view().price).toBeNull();
  });
});
