import { Cents, EpochMs, type MsgId } from '@gavel/shared';
import { describe, expect, it, vi } from 'vitest';
import { MAX_FINISHED_BIDS, PendingBids } from '../../src/store/localEvents';
import { bidId, bidderId, msgId } from '../../src/testing/builders';
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
