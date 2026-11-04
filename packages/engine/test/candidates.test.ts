import { describe, expect, it } from 'vitest';
import { candidates } from '../src/rules/candidates.js';
import { A, B, C, L1, bid, lotConfig, open, scene } from './decide-helpers.js';
import type { LotState } from '../src/state.js';

function lotAfter(mode: 'proxy' | 'second_price', bids: Array<[typeof A, number]>): LotState {
  const cfg = lotConfig(
    L1,
    mode === 'proxy'
      ? { mode, reserveCents: 100, increment: { flatCents: 50 } }
      : { mode, reserveCents: 400, increment: { flatCents: 50 } },
  );
  let s = open(scene({ lots: [cfg] }), L1);
  let at = 200;
  for (const [who, amount] of bids) {
    s = bid(s, at, who, amount).state;
    at += 10;
  }
  const lot = s.lots[L1];
  if (lot === undefined) throw new Error('lot missing');
  return lot;
}

describe('candidates', () => {
  it('T-ENG-041 R-ENG-055 R-ENG-019 proxy runner-up is priced without earlier candidates', () => {
    const lot = lotAfter('proxy', [
      [A, 900],
      [B, 600],
      [C, 300],
    ]);
    expect(candidates(lot, new Set(), 2)).toEqual([
      { bidderId: A, priceCents: 650 },
      { bidderId: B, priceCents: 350 },
      { bidderId: C, priceCents: 100 },
    ]);
    expect(candidates(lot, new Set([A]), 2)).toEqual([
      { bidderId: B, priceCents: 350 },
      { bidderId: C, priceCents: 100 },
    ]);
  });

  it('T-ENG-042 R-ENG-055 R-ENG-023 sealed price drops to the reserve as bidders are removed', () => {
    const lot = lotAfter('second_price', [
      [A, 900],
      [B, 700],
      [C, 500],
    ]);
    expect(candidates(lot, new Set(), 2).map((c) => c.priceCents)).toEqual([700, 500, 400]);
    expect(candidates(lot, new Set([A]), 2).map((c) => c.priceCents)).toEqual([500, 400]);
    expect(candidates(lot, new Set([A, B]), 2)).toEqual([{ bidderId: C, priceCents: 400 }]);
  });

  it('T-ENG-041 R-ENG-051 depth limits the runner-ups and english pays the own bid', () => {
    let s = open(scene(), L1);
    s = bid(s, 200, A, 1000).state;
    s = bid(s, 300, B, 1500).state;
    s = bid(s, 400, C, 2000).state;
    const lot = s.lots[L1];
    if (lot === undefined) throw new Error('lot missing');
    expect(candidates(lot, new Set(), 1)).toEqual([
      { bidderId: C, priceCents: 2000 },
      { bidderId: B, priceCents: 1500 },
    ]);
    expect(candidates(lot, new Set([C, B, A]), 3)).toEqual([]);
  });
});
