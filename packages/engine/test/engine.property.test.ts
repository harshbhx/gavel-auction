import fc from 'fast-check';
import { SEED as PROPERTY_SEED, runsFor } from './property-params.js';
import { describe, expect, it } from 'vitest';
import { bestByBidder, rank } from '../src/rules/ranking.js';
import type { BidRecord } from '../src/rules/ranking.js';
import type { AuctionState } from '../src/state.js';
import { A, B, C, L1, bid, lotConfig, open, scene } from './decide-helpers.js';

// R-QA-023: at least 200 runs per property, and the seed is printed so a failure can be replayed
// (set GAVEL_PROPERTY_SEED to reuse one).
const SEED = PROPERTY_SEED;
const NUM_RUNS = runsFor('engine.property', 300);
const params = { seed: SEED, numRuns: NUM_RUNS };

const CEILING = 90000;
const bidders = [A, B, C] as const;

const step = fc.record({
  who: fc.integer({ min: 0, max: 2 }),
  amount: fc.integer({ min: 0, max: 120000 }),
  dt: fc.integer({ min: 0, max: 1500 }),
});

function play(steps: ReadonlyArray<{ who: number; amount: number; dt: number }>): AuctionState[] {
  const lot = lotConfig(L1, {
    reserveCents: 1000,
    increment: { flatCents: 100 },
    softClose: { windowMs: 30000, extensionMs: 30000, maxExtensions: 3 },
  });
  let s = open(scene({ lots: [lot] }), L1);
  const states: AuctionState[] = [s];
  let at = 100;
  for (const st of steps) {
    at = Math.min(at + st.dt, 9900);
    s = bid(s, at, bidders[st.who] ?? A, st.amount).state;
    states.push(s);
  }
  return states;
}

const topAmount = (s: AuctionState): number =>
  Math.max(
    0,
    ...(s.lots[L1]?.bids ?? []).filter((b) => b.status === 'active').map((b) => b.amountCents),
  );

describe('engine properties (R-QA-023)', () => {
  it('the standing price never decreases', () => {
    fc.assert(
      fc.property(fc.array(step, { maxLength: 40 }), (steps) => {
        const tops = play(steps).map(topAmount);
        for (let i = 1; i < tops.length; i += 1) {
          expect(tops[i] ?? 0).toBeGreaterThanOrEqual(tops[i - 1] ?? 0);
        }
      }),
      params,
    );
  });

  it('the leader holds the highest valid bid, ties going to the earliest bid', () => {
    fc.assert(
      fc.property(fc.array(step, { maxLength: 40 }), (steps) => {
        const lot = play(steps).at(-1)?.lots[L1];
        const active = (lot?.bids ?? []).filter((b) => b.status === 'active');
        if (active.length === 0) {
          expect(lot?.leaderId ?? null).toBeNull();
          return;
        }
        const max = Math.max(...active.map((b) => b.amountCents));
        const top = active
          .filter((b) => b.amountCents === max)
          .sort((x, y) => x.at - y.at || x.seq - y.seq)[0];
        expect(lot?.leaderId).toBe(top?.bidderId);
      }),
      params,
    );
  });

  it('the soft-close deadline never moves earlier', () => {
    fc.assert(
      fc.property(fc.array(step, { maxLength: 40 }), (steps) => {
        const ends = play(steps).map((s) => s.lots[L1]?.endsAt ?? 0);
        for (let i = 1; i < ends.length; i += 1) {
          expect(ends[i] ?? 0).toBeGreaterThanOrEqual(ends[i - 1] ?? 0);
        }
      }),
      params,
    );
  });

  it('no accepted bid is above the bidder ceiling', () => {
    fc.assert(
      fc.property(fc.array(step, { maxLength: 40 }), (steps) => {
        for (const b of play(steps).at(-1)?.lots[L1]?.bids ?? []) {
          expect(b.amountCents).toBeLessThanOrEqual(CEILING);
        }
      }),
      params,
    );
  });
});

describe('ranking properties (R-QA-023)', () => {
  const raw = fc.record({
    bidder: fc.integer({ min: 0, max: 5 }),
    amountCents: fc.integer({ min: 1, max: 5000 }),
    at: fc.integer({ min: 0, max: 100 }),
  });
  const toRecords = (raws: ReadonlyArray<{ bidder: number; amountCents: number; at: number }>) =>
    raws.map(
      (r, i): BidRecord => ({
        bidderId: `b${r.bidder}`,
        amountCents: r.amountCents,
        at: r.at,
        bidId: `id${i}`,
        seq: i,
        status: 'active',
      }),
    );

  it('rank 1 is the highest amount with the earliest time on a tie', () => {
    fc.assert(
      fc.property(fc.array(raw, { minLength: 1, maxLength: 30 }), (raws) => {
        const bids = toRecords(raws);
        const ranked = rank(bids);
        const best = [...bestByBidder(bids).values()];
        const max = Math.max(...best.map((b) => b.amountCents));
        const earliest = Math.min(...best.filter((b) => b.amountCents === max).map((b) => b.at));
        expect(ranked[0]?.amountCents).toBe(max);
        expect(ranked[0]?.at).toBe(earliest);
        for (let i = 1; i < ranked.length; i += 1) {
          expect(ranked[i - 1]?.amountCents ?? 0).toBeGreaterThanOrEqual(
            ranked[i]?.amountCents ?? 0,
          );
        }
      }),
      params,
    );
  });
});
