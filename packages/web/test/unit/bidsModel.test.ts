import { describe, expect, it } from 'vitest';
import { bidRowId, diffBids, isEmptyDiff } from '../../src/grid/bidsModel';
import type { BidStreamRow } from '../../src/screens/console/BidStream';

function bid(seq: number, extra: Partial<BidStreamRow> = {}): BidStreamRow {
  return {
    id: `b${seq}`,
    serverTs: 1_700_000_000_000 + seq,
    seq,
    paddle: 1,
    amountCents: seq * 500,
    source: 'manual',
    confidence: null,
    status: 'accepted',
    reason: null,
    ...extra,
  };
}

describe('bid history diff', () => {
  it('sends only what is new, changed or gone', () => {
    const before = [bid(1), bid(2, { status: 'pending' }), bid(3)];
    const after = [bid(2, { status: 'accepted' }), bid(3), bid(4)];
    const diff = diffBids(before, after);
    expect(diff.add.map((r) => r.seq)).toEqual([4]);
    expect(diff.update.map((r) => r.seq)).toEqual([2]);
    expect(diff.remove.map((r) => r.seq)).toEqual([1]);
  });

  it('is empty when nothing changed, whatever the order', () => {
    const rows = [bid(1), bid(2)];
    expect(isEmptyDiff(diffBids(rows, [...rows].reverse()))).toBe(true);
  });

  it('keys a bid by id and seq', () => {
    expect(bidRowId(bid(5))).toBe('b5-5');
  });
});
