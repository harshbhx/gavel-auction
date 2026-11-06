import { Cents, EpochMs, type MsgId, type RoomSnapshot } from '@gavel/shared';
import { describe, expect, it, vi } from 'vitest';
import { MAX_FINISHED_BIDS, PendingBids, summarizePending } from '../../src/store/localEvents';
import { bidId, bidderId, msgId, openSnapshot, roster } from '../../src/testing/builders';
import type { ClientMessage, ErrorCode, ServerMessage } from '../../src/wire';

function setup() {
  vi.useFakeTimers();
  const sent: ClientMessage[] = [];
  let n = 0;
  const bids = new PendingBids({
    send: (m) => sent.push(m),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as number),
    newId: () => msgId((n += 1)),
  });
  return { bids, sent };
}

const base = { v: 1, seq: 1, ts: EpochMs(1) } as const;
const accepted = (mid: MsgId): ServerMessage => ({
  ...base,
  t: 'bid_accepted',
  mid,
  bidId: bidId(1),
  amount: Cents(35_000),
});
const rejected = (mid: MsgId, reason: ErrorCode): ServerMessage => ({
  ...base,
  t: 'bid_rejected',
  mid,
  reason,
  retryable: false,
});
const amount = (n: number) => Cents(n);

describe('latest bid outcome (#1655, #1657)', () => {
  it('shows no rejection once a newer bid is pending or accepted', () => {
    const { bids } = setup();
    const first = bids.submitBid(amount(35_000), 'qr');
    bids.handle(rejected(first, 'below_increment'));
    expect(summarizePending(bids.list()).rejection).toEqual({
      reason: 'below_increment',
      mid: first,
    });
    const second = bids.submitBid(amount(40_000), 'qr');
    expect(summarizePending(bids.list())).toMatchObject({ waiting: true, rejection: null });
    bids.handle(accepted(second));
    expect(summarizePending(bids.list())).toMatchObject({ waiting: false, rejection: null });
    vi.useRealTimers();
  });

  it('tells two identical rejections apart by bid id', () => {
    const { bids } = setup();
    const first = bids.submitBid(amount(35_000), 'qr');
    bids.handle(rejected(first, 'below_increment'));
    const second = bids.submitBid(amount(35_000), 'qr');
    bids.handle(rejected(second, 'below_increment'));
    expect(summarizePending(bids.list()).rejection?.mid).toBe(second);
    vi.useRealTimers();
  });

  it('marks a bid unknown at once when the transport did not send it, and resends it', () => {
    vi.useFakeTimers();
    let open = false;
    const sent: ClientMessage[] = [];
    const bids = new PendingBids({
      send: (m) => {
        if (!open) return false;
        sent.push(m);
        return true;
      },
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as number),
      newId: () => msgId(1),
    });
    const id = bids.submitBid(amount(35_000), 'qr');
    expect(bids.get(id)?.status).toBe('unknown');
    expect(summarizePending(bids.list()).unknownMid).toBe(id);
    open = true;
    expect(bids.retry(id)).toBe(true);
    expect(bids.get(id)?.status).toBe('pending');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ mid: id });
    vi.useRealTimers();
  });
});

describe('pending bids (T-WEB-015)', () => {
  it('is pending immediately and sends the bid', () => {
    const { bids, sent } = setup();
    const id = bids.submitBid(amount(35_000), 'qr');
    expect(bids.get(id)?.status).toBe('pending');
    expect(sent).toEqual([{ v: 1, t: 'bid', mid: id, amount: 35_000, source: 'qr' }]);
    vi.useRealTimers();
  });

  it('resolves to accepted by mid', () => {
    const { bids } = setup();
    const id = bids.submitBid(amount(35_000), 'qr');
    bids.handle(accepted(id));
    expect(bids.get(id)?.status).toBe('accepted');
    vi.advanceTimersByTime(10_000);
    expect(bids.get(id)?.status).toBe('accepted');
    vi.useRealTimers();
  });

  it('resolves to rejected with the code', () => {
    const { bids } = setup();
    const id = bids.submitBid(amount(35_000), 'qr');
    bids.handle(rejected(id, 'over_ceiling'));
    expect(bids.get(id)).toMatchObject({ status: 'rejected', code: 'over_ceiling' });
    vi.useRealTimers();
  });

  it('ignores results for other bids', () => {
    const { bids } = setup();
    const id = bids.submitBid(amount(35_000), 'qr');
    bids.handle(accepted(msgId(99)));
    expect(bids.get(id)?.status).toBe('pending');
    vi.useRealTimers();
  });

  it('turns unknown at 4000 ms and resends with the same mid', () => {
    const { bids, sent } = setup();
    const id = bids.submitBid(amount(35_000), 'qr');
    vi.advanceTimersByTime(3999);
    expect(bids.get(id)?.status).toBe('pending');
    vi.advanceTimersByTime(1);
    expect(bids.get(id)?.status).toBe('unknown');

    expect(bids.retry(id)).toBe(true);
    expect(bids.get(id)?.status).toBe('pending');
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);

    bids.handle(accepted(id));
    expect(bids.get(id)?.status).toBe('accepted');
    expect(bids.list()).toHaveLength(1);
    vi.useRealTimers();
  });

  it('a late result after unknown still resolves the bid', () => {
    const { bids } = setup();
    const id = bids.submitBid(amount(1_000), 'qr');
    vi.advanceTimersByTime(4000);
    bids.handle(accepted(id));
    expect(bids.get(id)?.status).toBe('accepted');
    vi.useRealTimers();
  });

  it('does not retry a bid that is not unknown', () => {
    const { bids, sent } = setup();
    const id = bids.submitBid(amount(1_000), 'qr');
    expect(bids.retry(id)).toBe(false);
    expect(sent).toHaveLength(1);
    vi.useRealTimers();
  });

  it('notifies subscribers on each change', () => {
    const { bids } = setup();
    let calls = 0;
    bids.subscribe(() => (calls += 1));
    const id = bids.submitBid(amount(1_000), 'qr');
    bids.handle(accepted(id));
    expect(calls).toBe(2);
    vi.useRealTimers();
  });

  it('sends the source it was given and the bidder it bids for (WEB-RT-16)', () => {
    const { bids, sent } = setup();
    bids.submitBid(amount(5_000), 'manual', bidderId(7));
    bids.submitBid(amount(6_000), 'voice');
    expect(sent.map((m) => (m.t === 'bid' ? m.source : null))).toEqual(['manual', 'voice']);
    expect(sent[0]).toMatchObject({ bidderId: bidderId(7) });
    vi.useRealTimers();
  });

  it('keeps only the newest finished bids (WEB-RT-16)', () => {
    const { bids } = setup();
    const ids: MsgId[] = [];
    for (let i = 0; i < MAX_FINISHED_BIDS + 20; i += 1) {
      const id = bids.submitBid(amount(1_000 + i), 'qr');
      ids.push(id);
      bids.handle(accepted(id));
    }
    expect(bids.list()).toHaveLength(MAX_FINISHED_BIDS);
    expect(bids.get(ids[0] as MsgId)).toBeUndefined();
    expect(bids.get(ids[ids.length - 1] as MsgId)?.status).toBe('accepted');
    vi.useRealTimers();
  });

  it('never evicts a bid that is still pending', () => {
    const { bids } = setup();
    const first = bids.submitBid(amount(1_000), 'qr');
    for (let i = 0; i < MAX_FINISHED_BIDS + 5; i += 1) {
      bids.handle(accepted(bids.submitBid(amount(2_000 + i), 'qr')));
    }
    expect(bids.get(first)?.status).toBe('pending');
    vi.useRealTimers();
  });
});

const seen = (highBid?: number): RoomSnapshot => ({
  ...openSnapshot(roster([1, 'Priya'])),
  you: {
    bidderId: bidderId(1),
    ceiling: Cents(100_000),
    ...(highBid === undefined ? {} : { highBid: Cents(highBid) }),
  },
});

describe('unanswered bids (#1785)', () => {
  it('keeps the bid unknown, and the screen locked, until it is resolved or cancelled', () => {
    const { bids } = setup();
    const id = bids.submitBid(amount(35_000), 'qr');
    vi.advanceTimersByTime(4100);
    expect(summarizePending(bids.list())).toMatchObject({ waiting: false, unknownMid: id });
    vi.advanceTimersByTime(60_000);
    expect(summarizePending(bids.list())).toMatchObject({ unknownMid: id, unknownAmount: 35_000 });
    expect(bids.cancel(id)).toBe(true);
    expect(summarizePending(bids.list()).unknownMid).toBeNull();
    expect(bids.cancel(id)).toBe(false);
    vi.useRealTimers();
  });

  it('does not cancel a bid that is still waiting for its answer', () => {
    const { bids } = setup();
    const id = bids.submitBid(amount(35_000), 'qr');
    expect(bids.cancel(id)).toBe(false);
    expect(bids.get(id)?.status).toBe('pending');
    vi.useRealTimers();
  });

  it('marks an unknown bid accepted when the snapshot shows the high bid reached it', () => {
    const { bids } = setup();
    const id = bids.submitBid(amount(35_000), 'qr');
    vi.advanceTimersByTime(4100);
    bids.reconcile(seen(35_000));
    expect(bids.get(id)?.status).toBe('accepted');
    expect(summarizePending(bids.list()).unknownMid).toBeNull();
    vi.useRealTimers();
  });

  it('marks an unknown bid accepted when the snapshot shows this bidder leading at its amount', () => {
    const { bids } = setup();
    const id = bids.submitBid(amount(35_000), 'qr');
    vi.advanceTimersByTime(4100);
    const lead = { ...seen(), leaderId: bidderId(1), price: Cents(35_000) };
    bids.reconcile({ ...lead, price: Cents(30_000) });
    expect(bids.get(id)?.status).toBe('unknown');
    bids.reconcile(lead);
    expect(bids.get(id)?.status).toBe('accepted');
    vi.useRealTimers();
  });

  it('leaves an unknown bid unknown when the snapshot shows a lower or no high bid', () => {
    const { bids } = setup();
    const id = bids.submitBid(amount(35_000), 'qr');
    vi.advanceTimersByTime(4100);
    bids.reconcile(seen(30_000));
    bids.reconcile(seen());
    expect(bids.get(id)?.status).toBe('unknown');
    vi.useRealTimers();
  });
});
