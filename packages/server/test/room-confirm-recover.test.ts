import type { BidMsg, EpochMs, MsgId } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { CONFIRM_TTL_MS } from '../src/room/confirm';
import { FlakyStore, setup } from './room-harness';

/** A store whose append commits and then reports failure, like a timeout after the write. */
class CommitThenFailStore extends FlakyStore {
  commitThenFail = 0;
  override async appendEvents(...args: Parameters<FlakyStore['appendEvents']>): Promise<void> {
    await super.appendEvents(...args);
    if (this.commitThenFail > 0) {
      this.commitThenFail -= 1;
      throw new Error('timeout after commit');
    }
  }
}

const lowVoice = (mid: MsgId, amount: number): BidMsg => ({
  v: 1,
  t: 'bid',
  mid,
  amount,
  source: 'voice',
  confidence: 0.62,
});

const outcomes = async (t: Awaited<ReturnType<typeof setup>>, confirmId: string) =>
  (await t.store.readEvents(t.auctionId, 1, 100))
    .filter((e) => e.type === 'confirm_resolved' && e.confirmId === confirmId)
    .map((e) => (e.type === 'confirm_resolved' ? e.outcome : ''));

describe('recover() rebuilds the confirm book (R12-V07)', () => {
  it('an accept that commits after failing is not expired later', async () => {
    const store = new CommitThenFailStore();
    const t = await setup({ store });
    const c1 = await t.connect('bidder', t.b1);
    const mid = t.ids.mint<'MsgId'>();
    await t.room.submitBid(c1.conn, lowVoice(mid, 12000));
    const confirmId = String(c1.transport.messages('confirm_request')[0]?.confirmId);
    store.commitThenFail = 1;
    await t.room.respondConfirm(c1.conn, { v: 1, t: 'confirm_response', confirmId, accept: true });
    expect(await outcomes(t, confirmId)).toEqual(['accepted']);
    t.clock.set((t.clock.now() + CONFIRM_TTL_MS + 1000) as EpochMs);
    await t.connect('screen');
    expect(await outcomes(t, confirmId)).toEqual(['accepted']);
    const unconfirmed = c1.transport
      .messages('bid_rejected')
      .filter((m) => m.reason === 'unconfirmed');
    expect(unconfirmed).toHaveLength(0);
  });

  it('a request that commits after failing is still resolved at its deadline', async () => {
    const store = new CommitThenFailStore();
    const t = await setup({ store });
    const c1 = await t.connect('bidder', t.b1);
    store.commitThenFail = 1;
    await t.room.submitBid(c1.conn, lowVoice(t.ids.mint<'MsgId'>(), 12000));
    const requested = (await t.store.readEvents(t.auctionId, 1, 100)).find(
      (e) => e.type === 'confirm_requested',
    );
    expect(requested).toBeDefined();
    const confirmId = requested?.type === 'confirm_requested' ? requested.confirmId : '';
    t.clock.set((t.clock.now() + CONFIRM_TTL_MS + 1000) as EpochMs);
    await t.connect('screen');
    expect(await outcomes(t, confirmId)).toEqual(['expired']);
  });
});
