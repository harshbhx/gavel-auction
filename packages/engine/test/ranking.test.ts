import { describe, expect, it } from 'vitest';
import { bestByBidder, rank } from '../src/rules/ranking.js';
import type { BidRecord } from '../src/rules/ranking.js';

function mulberry(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const bid = (
  n: number,
  amountCents: number,
  at: number,
  status: 'active' | 'struck' = 'active',
): BidRecord => ({
  bidId: `b${n}`,
  bidderId: `bidder${n}`,
  amountCents,
  at,
  seq: n,
  status,
});

describe('ranking', () => {
  it('T-ENG-021 (R-ENG-024): order is amount desc, at asc, seq asc for shuffled insertions', () => {
    const base: BidRecord[] = [
      bid(1, 500, 10),
      bid(2, 500, 10),
      bid(3, 700, 20),
      bid(4, 700, 5),
      bid(5, 500, 3),
      bid(6, 900, 50),
      bid(7, 900, 50),
      bid(8, 100, 1),
      bid(9, 700, 5),
      bid(10, 500, 10),
    ];
    const expected = [...base]
      .sort((a, b) => b.amountCents - a.amountCents || a.at - b.at || a.seq - b.seq)
      .map((b) => b.bidId);
    const rnd = mulberry(42);
    for (let i = 0; i < 1000; i++) {
      const s = [...base];
      for (let j = s.length - 1; j > 0; j--) {
        const k = Math.floor(rnd() * (j + 1));
        const t = s[j] as BidRecord;
        s[j] = s[k] as BidRecord;
        s[k] = t;
      }
      expect(rank(s).map((r) => r.bidId)).toEqual(expected);
    }
  });

  it('R-ENG-024: uses best active bid per bidder and ignores struck bids', () => {
    const bids: BidRecord[] = [
      { ...bid(1, 500, 1), bidderId: 'a' },
      { ...bid(2, 800, 2), bidderId: 'a' },
      { ...bid(3, 900, 3, 'struck'), bidderId: 'a' },
      { ...bid(4, 600, 4), bidderId: 'b' },
    ];
    expect(bestByBidder(bids).get('a')?.amountCents).toBe(800);
    const r = rank(bids);
    expect(r.map((x) => [x.bidderId, x.amountCents, x.rank])).toEqual([
      ['a', 800, 1],
      ['b', 600, 2],
    ]);
  });

  it('R-ENG-024: a bidder with only struck bids is not ranked', () => {
    expect(rank([bid(1, 500, 1, 'struck')])).toEqual([]);
  });
});
