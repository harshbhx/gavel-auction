import type { BidMsg, Cents, MsgId } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CAPS } from '../src/limits/caps';
import { Room } from '../src/room/room';
import { FlakyStore, setup } from './room-harness';

const lowVoice = (mid: MsgId, amount: number): BidMsg => ({
  v: 1,
  t: 'bid',
  mid,
  amount,
  source: 'voice',
  confidence: 0.62,
});

const types = async (t: Awaited<ReturnType<typeof setup>>) =>
  (await t.store.readEvents(t.auctionId, 1, 100)).map((e) => e.type);

const ask = async (opts: Parameters<typeof setup>[0] = {}) => {
  const t = await setup(opts);
  const c1 = await t.connect('bidder', t.b1);
  const mid = t.ids.mint<'MsgId'>();
  await t.room.submitBid(c1.conn, lowVoice(mid, 12000));
  const confirmId = String(c1.transport.messages('confirm_request')[0]?.confirmId);
  const answer = () =>
    t.room.respondConfirm(c1.conn, { v: 1, t: 'confirm_response', confirmId, accept: true });
  return { t, c1, mid, confirmId, answer };
};

describe('confirm accept is one append (HRD-23, #1519)', () => {
  it('writes the accepted resolution and the bid in one batch', async () => {
    const store = new FlakyStore();
    const batches: string[][] = [];
    const orig = store.appendEvents.bind(store);
    store.appendEvents = async (id, seq, events) => {
      batches.push(events.map((e) => e.type));
      return orig(id, seq, events);
    };
    const { answer } = await ask({ store });
    await answer();
    expect(batches.at(-1)).toEqual(['confirm_resolved', 'bid_accepted']);
  });

  it('a store failure on the accept loses nothing and the same confirmation can be answered again', async () => {
    const store = new FlakyStore();
    const { t, c1, mid, answer } = await ask({ store });
    const before = await types(t);
    store.failNext = 1;
    await answer();
    expect(await types(t)).toEqual(before);
    expect(c1.transport.messages('error').length).toBeGreaterThan(0);
    await answer();
    expect((await types(t)).slice(before.length)).toEqual(['confirm_resolved', 'bid_accepted']);
    expect(t.room.activeEngine?.view().price).toBe(12000);
    expect(c1.transport.messages('bid_accepted')[0]).toMatchObject({ mid });
  });

  it('a crash before the accept append leaves the hold open for the restarted room', async () => {
    const store = new FlakyStore();
    const { t, confirmId } = await ask({ store });
    store.failNext = 1;
    const c = await t.connect('bidder', t.b1);
    await t.room.respondConfirm(c.conn, { v: 1, t: 'confirm_response', confirmId, accept: true });
    expect(await types(t)).not.toContain('confirm_resolved');
    const reborn = await Room.load(t.auctionId, { ...t.deps, store });
    const c2 = await t.connect('bidder', t.b1);
    await reborn.attach(c2.conn);
    await reborn.respondConfirm(c2.conn, {
      v: 1,
      t: 'confirm_response',
      confirmId,
      accept: true,
    });
    expect(await types(t)).toContain('bid_accepted');
    expect(reborn.activeEngine?.view().price).toBe(12000);
  });

  it('the bid cap between ask and answer refuses without spending the confirmation', async () => {
    const { t, c1, confirmId, answer } = await ask({
      caps: { ...DEFAULT_CAPS, bidsPerAuction: 1 },
    });
    const c2 = await t.connect('bidder', t.b2);
    await t.room.submitBid(c2.conn, t.bid(15000));
    await answer();
    expect(c1.transport.messages('error').map((m) => m.code)).toContain('auction_full');
    expect(await types(t)).not.toContain('confirm_resolved');
    const e = (await t.store.readEvents(t.auctionId, 1, 100)).filter(
      (x) => x.type === 'confirm_resolved',
    );
    expect(e).toHaveLength(0);
    expect(confirmId.length).toBeGreaterThan(0);
    expect(t.room.activeEngine?.view().price).toBe(15000 as Cents);
  });
});
