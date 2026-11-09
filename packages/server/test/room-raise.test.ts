import type { Cents } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { redactEventForExport } from '../src/auth/authorize';
import { Room } from '../src/room/room';
import { setup } from './room-harness';

// FEAT-61 (D-0025): a registered bidder replaces their hold with a larger one while the lot is open.
describe('room: raising a limit', () => {
  it('raises the ceiling, logs one ceiling_raised event and tells the bidder', async () => {
    const t = await setup();
    const c1 = await t.connect('bidder', t.b1);
    const before = t.room.lastSeq;

    await t.room.registerBidder({
      bidderId: t.b1,
      name: '',
      ceiling: 80000 as Cents,
      holdRef: 'h1b',
    });

    expect(t.room.lastSeq).toBe(before + 1);
    expect(t.room.holdRefs.get(t.b1)).toBe('h1b');
    const events = await t.store.readEvents(t.auctionId, 1, 100);
    const raised = events.filter((e) => e.type === 'ceiling_raised');
    expect(raised).toEqual([
      expect.objectContaining({
        bidderId: t.b1,
        from: 50000,
        ceiling: 80000,
        holdRef: 'h1b',
        seq: before + 1,
      }),
    ]);
    // The owner's own socket learns the new limit; the export of the event hides the amounts.
    expect(c1.transport.messages('registered').at(-1)).toMatchObject({
      bidderId: t.b1,
      ceiling: 80000,
    });
    const exported = redactEventForExport('auctioneer', raised[0] as never);
    expect(exported).not.toHaveProperty('ceiling');
    expect(exported).not.toHaveProperty('from');
  });

  it('lets the bidder bid over the old limit afterwards, and not before', async () => {
    const t = await setup();
    const c1 = await t.connect('bidder', t.b1);
    await t.room.submitBid(c1.conn, t.bid(60000));
    expect(c1.transport.messages('bid_rejected').at(-1)).toMatchObject({ reason: 'over_ceiling' });
    await t.room.registerBidder({
      bidderId: t.b1,
      name: '',
      ceiling: 80000 as Cents,
      holdRef: 'h1b',
    });
    await t.room.submitBid(c1.conn, t.bid(60000));
    expect(c1.transport.messages('bid_accepted').at(-1)).toMatchObject({ amount: 60000 });
  });

  it('is idempotent for the same hold and refuses a lower or equal limit', async () => {
    const t = await setup();
    const raise = (ceiling: number, holdRef: string) =>
      t.room.registerBidder({ bidderId: t.b1, name: '', ceiling: ceiling as Cents, holdRef });
    await raise(80000, 'h1b');
    const seq = t.room.lastSeq;
    await raise(80000, 'h1b');
    expect(t.room.lastSeq).toBe(seq);
    await expect(raise(80000, 'h1c')).rejects.toMatchObject({ code: 'conflict' });
    await expect(raise(70000, 'h1d')).rejects.toMatchObject({ code: 'conflict' });
    expect(t.room.holdRefs.get(t.b1)).toBe('h1b');
    expect(t.room.lastSeq).toBe(seq);
  });

  it('survives a reload from the log', async () => {
    const t = await setup();
    await t.room.registerBidder({
      bidderId: t.b1,
      name: '',
      ceiling: 80000 as Cents,
      holdRef: 'h1b',
    });
    const again = await Room.load(t.auctionId, t.deps);
    expect(again.holdRefs.get(t.b1)).toBe('h1b');
    expect(again.lastSeq).toBe(t.room.lastSeq);
  });
});
