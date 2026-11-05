import type { BidMsg, Cents, EpochMs, MsgId } from '@gavel/shared';
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

const held = async () => {
  const t = await setup();
  const c1 = await t.connect('bidder', t.b1);
  const mid = t.ids.mint<'MsgId'>();
  await t.room.submitBid(c1.conn, lowVoice(mid, 12000));
  const ask = c1.transport.messages('confirm_request')[0];
  const confirmId = String(ask?.confirmId);
  const resolved = async () =>
    (await t.store.readEvents(t.auctionId, 1, 100)).filter((e) => e.type === 'confirm_resolved');
  return { t, c1, mid, confirmId, resolved };
};

describe('confirm response, rejection and expiry (T-RT-037)', () => {
  it('accept after 4 s places the bid with the server time of the answer', async () => {
    const { t, c1, mid, confirmId, resolved } = await held();
    const askedAt = t.clock.now();
    t.clock.set((askedAt + 4000) as EpochMs);
    await t.room.respondConfirm(c1.conn, { v: 1, t: 'confirm_response', confirmId, accept: true });
    const events = await t.store.readEvents(t.auctionId, 1, 100);
    const accepted = events.find((e) => e.type === 'bid_accepted');
    expect(accepted).toMatchObject({ amount: 12000 as Cents, ts: askedAt + 4000, mid });
    expect(accepted?.type === 'bid_accepted' ? accepted.audit.confirmed : false).toBe(true);
    expect((await resolved()).map((e) => (e.type === 'confirm_resolved' ? e.outcome : ''))).toEqual(
      ['accepted'],
    );
    expect(t.room.activeEngine?.view().price).toBe(12000);
    expect(c1.transport.messages('bid_accepted')).toHaveLength(1);
  });

  it('reject audits rejected and creates no bid', async () => {
    const { t, c1, mid, confirmId, resolved } = await held();
    await t.room.respondConfirm(c1.conn, { v: 1, t: 'confirm_response', confirmId, accept: false });
    const [ev] = await resolved();
    expect(ev).toMatchObject({ type: 'confirm_resolved', outcome: 'rejected' });
    expect(t.room.activeEngine?.view().price).toBeNull();
    expect(c1.transport.messages('bid_rejected')[0]).toMatchObject({ mid, reason: 'unconfirmed' });
  });

  it('no answer for 15 s audits expired and creates no bid', async () => {
    const { t, resolved } = await held();
    t.clock.set((t.clock.now() + CONFIRM_TTL_MS) as EpochMs);
    await t.connect('screen');
    const [ev] = await resolved();
    expect(ev).toMatchObject({ type: 'confirm_resolved', outcome: 'expired' });
    expect(t.room.activeEngine?.view().price).toBeNull();
    const events = await t.store.readEvents(t.auctionId, 1, 100);
    expect(events.some((e) => e.type === 'bid_accepted')).toBe(false);
  });

  it('refuses an answer from another bidder, and a repeat of an answered one', async () => {
    const { t, c1, confirmId } = await held();
    const c2 = await t.connect('bidder', t.b2);
    await t.room.respondConfirm(c2.conn, { v: 1, t: 'confirm_response', confirmId, accept: true });
    expect(c2.transport.messages('error')[0]).toMatchObject({ code: 'not_found' });
    await t.room.respondConfirm(c1.conn, { v: 1, t: 'confirm_response', confirmId, accept: false });
    await t.room.respondConfirm(c1.conn, { v: 1, t: 'confirm_response', confirmId, accept: true });
    expect(c1.transport.messages('error')[0]).toMatchObject({ code: 'not_found' });
    expect(t.room.activeEngine?.view().price).toBeNull();
  });

  it('a newer low-confidence bid supersedes the held one', async () => {
    const { t, c1 } = await held();
    await t.room.submitBid(c1.conn, lowVoice(t.ids.mint<'MsgId'>(), 13000));
    const events = await t.store.readEvents(t.auctionId, 1, 100);
    expect(
      events
        .filter((e) => e.type === 'confirm_resolved')
        .map((e) => (e.type === 'confirm_resolved' ? e.outcome : '')),
    ).toEqual(['superseded']);
    expect(c1.transport.messages('confirm_request')).toHaveLength(2);
  });
});
