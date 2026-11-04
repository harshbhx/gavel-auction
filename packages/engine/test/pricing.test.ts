import { describe, expect, it } from 'vitest';
import { InvariantError } from '../src/errors.js';
import { incrementAt } from '../src/rules/increment.js';
import {
  assertWithinCeiling,
  checkBasicBid,
  hammerPrice,
  minNextBid,
} from '../src/rules/pricing-basic.js';
import type { PricingLot } from '../src/rules/pricing-basic.js';
import { checkProxyBid, currentPrice as proxyPrice } from '../src/rules/pricing-proxy.js';
import { rank } from '../src/rules/ranking.js';
import type { BidRecord, RankedBid } from '../src/rules/ranking.js';

let n = 0;
function b(bidderId: string, amountCents: number, at: number, seq?: number): BidRecord {
  n += 1;
  return { bidId: `b${n}`, bidderId, amountCents, at, seq: seq ?? n, status: 'active' };
}
const r = (bids: BidRecord[]): RankedBid[] => rank(bids);

describe('pricing basic', () => {
  it('T-ENG-014 (R-ENG-016, R-ENG-017, R-ENG-018): english flow', () => {
    const lot: PricingLot = { mode: 'english', reserveCents: 1000, increment: { flatCents: 500 } };
    const bids: BidRecord[] = [];
    expect(checkBasicBid(lot, r(bids), 'A', 999)).toBe('below_reserve');
    expect(checkBasicBid(lot, r(bids), 'A', 1000)).toBeNull();
    bids.push(b('A', 1000, 1));
    expect(hammerPrice(lot, r(bids))).toBe(1000);
    expect(checkBasicBid(lot, r(bids), 'B', 1400)).toBe('below_increment');
    expect(minNextBid(lot, r(bids))).toBe(1500);
    expect(checkBasicBid(lot, r(bids), 'B', 1500)).toBeNull();
    bids.push(b('B', 1500, 2));
    expect(checkBasicBid(lot, r(bids), 'B', 2000)).toBe('already_leading');
    expect(hammerPrice(lot, r(bids))).toBe(1500);
  });

  it('T-ENG-019 (R-ENG-022, R-ENG-023): second price', () => {
    const lot: PricingLot = {
      mode: 'second_price',
      reserveCents: 500,
      increment: { flatCents: 100 },
    };
    const bids = [b('A', 900, 1), b('B', 700, 2), b('C', 700, 3)];
    expect(hammerPrice(lot, r(bids))).toBe(700);
    expect(checkBasicBid(lot, r(bids), 'A', 1200)).toBe('already_bid');
    expect(hammerPrice(lot, r([b('A', 900, 1)]))).toBe(500);
  });

  it('T-ENG-020 (R-ENG-023): bid below reserve is rejected, single valid bidder pays reserve', () => {
    const lot: PricingLot = {
      mode: 'second_price',
      reserveCents: 800,
      increment: { flatCents: 100 },
    };
    expect(checkBasicBid(lot, [], 'B', 700)).toBe('below_reserve');
    expect(hammerPrice(lot, r([b('A', 900, 1)]))).toBe(800);
  });

  it('R-ENG-026: price over ceiling throws InvariantError', () => {
    expect(() => assertWithinCeiling(500, 500)).not.toThrow();
    expect(() => assertWithinCeiling(501, 500)).toThrow(InvariantError);
  });
});

describe('pricing proxy and increments', () => {
  it('T-ENG-015 (R-ENG-025, R-ENG-010): ladder increments', () => {
    const rule = {
      ladder: [
        { fromCents: 0, incrementCents: 100 },
        { fromCents: 10000, incrementCents: 500 },
        { fromCents: 50000, incrementCents: 1000 },
      ],
    };
    expect(9999 + incrementAt(rule, 9999)).toBe(10099);
    expect(10000 + incrementAt(rule, 10000)).toBe(10500);
    expect(50000 + incrementAt(rule, 50000)).toBe(51000);
  });

  it('T-ENG-016 (R-ENG-019, R-ENG-020): proxy price and own-max rule', () => {
    const lot: PricingLot = { mode: 'proxy', reserveCents: 100, increment: { flatCents: 50 } };
    const a = b('A', 1000, 1);
    expect(proxyPrice(lot, r([a]))).toBe(100);
    const bb = b('B', 400, 2);
    const two = r([a, bb]);
    expect(proxyPrice(lot, two)).toBe(450);
    expect(two[0]?.bidderId).toBe('A');
    const raised = b('B', 1000, 3);
    const tie = r([a, bb, raised]);
    expect(tie[0]?.bidderId).toBe('A');
    expect(proxyPrice(lot, tie)).toBe(1000);
    expect(checkProxyBid(lot, tie, 'B', 1000)).toBe('not_higher_than_own_max');
    expect(checkProxyBid(lot, tie, 'B', 1001)).toBeNull();
  });

  it('T-ENG-017 (R-ENG-021, R-ENG-024): equal maximums go to earlier (at, seq)', () => {
    const lot: PricingLot = { mode: 'proxy', reserveCents: 100, increment: { flatCents: 50 } };
    const x = r([b('B', 700, 10, 4), b('A', 700, 10, 3)]);
    expect(x[0]?.bidderId).toBe('A');
    expect(proxyPrice(lot, x)).toBe(700);
  });

  it('T-ENG-018 (R-ENG-019, R-ENG-026): price never above the top maximum', () => {
    const lot: PricingLot = { mode: 'proxy', reserveCents: 100, increment: { flatCents: 50 } };
    expect(proxyPrice(lot, r([b('A', 500, 1), b('B', 480, 2)]))).toBe(500);
  });
});
