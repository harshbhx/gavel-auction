import type { BidMsg, Cents, MsgId } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { CONFIRM_TTL_MS, ConfirmBook, needsConfirm } from '../src/room/confirm';
import { setup } from './room-harness';

const voice = (
  mid: MsgId,
  amount: number,
  extra: Partial<Pick<BidMsg, 'confidence' | 'ambiguous' | 'transcript'>> = {},
): BidMsg => ({ v: 1, t: 'bid', mid, amount, source: 'voice', ...extra });

describe('needsConfirm (R-RT-045)', () => {
  const mid = '01J9ZQ5A0B2C4D6F8H0J2K4M6N' as MsgId;
  it('asks below the threshold, on an ambiguous flag, never for other sources', () => {
    expect(needsConfirm(voice(mid, 100, { confidence: 0.62 }), 0.85)).toBe(true);
    expect(needsConfirm(voice(mid, 100, { confidence: 0.85 }), 0.85)).toBe(false);
    expect(needsConfirm(voice(mid, 100, { confidence: 0.99, ambiguous: true }), 0.85)).toBe(true);
    expect(needsConfirm({ v: 1, t: 'bid', mid, amount: 100, source: 'qr' }, 0.85)).toBe(false);
  });

  it('fails closed: a qr or manual label on a spoken bid still asks (INTEGRATION-RT-12)', () => {
    expect(
      needsConfirm(
        { ...voice(mid, 100, { confidence: 0.1, transcript: 'um' }), source: 'qr' },
        0.85,
      ),
    ).toBe(true);
    expect(
      needsConfirm({ v: 1, t: 'bid', mid, amount: 100, source: 'manual', transcript: 'x' }, 0.85),
    ).toBe(true);
  });

  it('holds a voice bid that carries no confidence at all (R7-03)', () => {
    expect(needsConfirm(voice(mid, 100), 0.85)).toBe(true);
    expect(needsConfirm({ ...voice(mid, 100), source: 'manual' }, 0.85)).toBe(false);
  });

  it('keeps one held bid per bidder and forgets a dropped one', () => {
    const book = new ConfirmBook();
    const bidderId = '01J9ZQ3A0B2C4D6F8H0J2K4M6N' as never;
    book.add({
      confirmId: 'c1',
      bidderId,
      mid,
      amount: 100 as Cents,
      expiresAt: 1 as never,
    });
    expect(book.forBidder(bidderId)?.confirmId).toBe('c1');
    book.drop('c1');
    expect(book.size).toBe(0);
    expect(book.forBidder(bidderId)).toBeUndefined();
  });
});

describe('confirm request on low confidence or ambiguity (T-RT-036)', () => {
  it('sends confirm_request to the bidder only and leaves the engine alone', async () => {
    const t = await setup();
    const c1 = await t.connect('bidder', t.b1);
    const c2 = await t.connect('bidder', t.b2);
    const screen = await t.connect('screen');
    await t.room.submitBid(
      c1.conn,
      voice(t.ids.mint<'MsgId'>(), 12000, { confidence: 0.62, transcript: 'twelve thousand' }),
    );
    const asks = c1.transport.messages('confirm_request');
    expect(asks).toHaveLength(1);
    expect(asks[0]).toMatchObject({
      amount: 12000,
      transcript: 'twelve thousand',
      expiresAt: t.clock.now() + CONFIRM_TTL_MS,
    });
    expect(c2.transport.messages('confirm_request')).toHaveLength(0);
    expect(screen.transport.messages('confirm_request')).toHaveLength(0);
    expect(t.room.activeEngine?.view().price).toBeNull();
    const events = await t.store.readEvents(t.auctionId, 1, 100);
    expect(events.some((e) => e.type === 'bid_accepted' || e.type === 'bid_rejected')).toBe(false);
    expect(events.at(-1)?.type).toBe('confirm_requested');
  });

  it('does not ask at the threshold, and asks for an ambiguous flag at 0.99', async () => {
    const t = await setup();
    const c1 = await t.connect('bidder', t.b1);
    await t.room.submitBid(c1.conn, voice(t.ids.mint<'MsgId'>(), 12000, { confidence: 0.85 }));
    expect(c1.transport.messages('confirm_request')).toHaveLength(0);
    expect(t.room.activeEngine?.view().price).toBe(12000);

    const c2 = await t.connect('bidder', t.b2);
    await t.room.submitBid(
      c2.conn,
      voice(t.ids.mint<'MsgId'>(), 13000, { confidence: 0.99, ambiguous: true }),
    );
    expect(c2.transport.messages('confirm_request')).toHaveLength(1);
    expect(t.room.activeEngine?.view().price).toBe(12000);
  });

  it('keeps every other viewer seq whole', async () => {
    const t = await setup();
    const c1 = await t.connect('bidder', t.b1);
    const screen = await t.connect('screen');
    await t.room.submitBid(c1.conn, voice(t.ids.mint<'MsgId'>(), 12000, { confidence: 0.5 }));
    const seqs = screen.transport.messages().map((m) => m.seq as number);
    expect(seqs.at(-1)).toBe(await t.store.lastSeq(t.auctionId));
  });
});
