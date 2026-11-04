import { describe, expect, it, vi } from 'vitest';
import { PendingBids } from '../../src/store/localEvents';
import type { ClientMessage, ServerMessage } from '../../src/wire';

function setup() {
  vi.useFakeTimers();
  const sent: ClientMessage[] = [];
  let n = 0;
  const bids = new PendingBids({
    paddle: 12,
    send: (m) => sent.push(m),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as number),
    newId: () => `cb-${(n += 1)}`,
  });
  return { bids, sent };
}

const base = { seq: 1, roomId: 'r', serverTime: 1 } as const;
const accepted = (id: string): ServerMessage => ({
  t: 'bid_accepted',
  ...base,
  clientBidId: id,
  paddle: 12,
  amountCents: 35_000,
});
const rejected = (id: string, code: string): ServerMessage => ({
  t: 'bid_rejected',
  ...base,
  clientBidId: id,
  code,
  message: 'no',
});

describe('pending bids (T-WEB-015)', () => {
  it('is pending immediately and sends the bid', () => {
    const { bids, sent } = setup();
    const id = bids.submitBid(35_000);
    expect(bids.get(id)?.status).toBe('pending');
    expect(sent).toEqual([
      { t: 'bid', clientBidId: id, paddle: 12, amountCents: 35_000, source: 'qr' },
    ]);
    vi.useRealTimers();
  });

  it('resolves to accepted by clientBidId', () => {
    const { bids } = setup();
    const id = bids.submitBid(35_000);
    bids.handle(accepted(id));
    expect(bids.get(id)?.status).toBe('accepted');
    vi.advanceTimersByTime(10_000);
    expect(bids.get(id)?.status).toBe('accepted');
    vi.useRealTimers();
  });

  it('resolves to rejected with the code', () => {
    const { bids } = setup();
    const id = bids.submitBid(35_000);
    bids.handle(rejected(id, 'over_ceiling'));
    expect(bids.get(id)).toMatchObject({ status: 'rejected', code: 'over_ceiling' });
    vi.useRealTimers();
  });

  it('ignores results for other bids', () => {
    const { bids } = setup();
    const id = bids.submitBid(35_000);
    bids.handle(accepted('someone-else'));
    expect(bids.get(id)?.status).toBe('pending');
    vi.useRealTimers();
  });

  it('turns unknown at 4000 ms and resends with the same clientBidId', () => {
    const { bids, sent } = setup();
    const id = bids.submitBid(35_000);
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
    const id = bids.submitBid(1_000);
    vi.advanceTimersByTime(4000);
    bids.handle(accepted(id));
    expect(bids.get(id)?.status).toBe('accepted');
    vi.useRealTimers();
  });

  it('does not retry a bid that is not unknown', () => {
    const { bids, sent } = setup();
    const id = bids.submitBid(1_000);
    expect(bids.retry(id)).toBe(false);
    expect(sent).toHaveLength(1);
    vi.useRealTimers();
  });

  it('notifies subscribers on each change', () => {
    const { bids } = setup();
    let calls = 0;
    bids.subscribe(() => (calls += 1));
    const id = bids.submitBid(1_000);
    bids.handle(accepted(id));
    expect(calls).toBe(2);
    vi.useRealTimers();
  });
});
