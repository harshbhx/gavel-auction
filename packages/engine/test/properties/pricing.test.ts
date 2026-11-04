import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { InvariantError } from '../../src/errors.js';
import {
  currentPrice as englishPrice,
  assertWithinCeiling,
} from '../../src/rules/pricing-basic.js';
import type { PricingLot } from '../../src/rules/pricing-basic.js';
import { currentPrice as proxyPrice } from '../../src/rules/pricing-proxy.js';
import { rank } from '../../src/rules/ranking.js';
import type { BidRecord } from '../../src/rules/ranking.js';
import type { AuctionState } from '../../src/state.js';
import type { Mode } from '../../src/types.js';
import { A, B, C, L1, bid, lotConfig, mk, open, run, scene } from '../decide-helpers.js';

// Seeded and replayable: set GAVEL_PROPERTY_SEED to reuse a seed, GAVEL_PROPERTY_RUNS for the
// nightly run (5000). The default is 500 runs.
const SEED = Number(process.env['GAVEL_PROPERTY_SEED'] ?? 20261104);
const NUM_RUNS = Number(process.env['GAVEL_PROPERTY_RUNS'] ?? 500);
const params = { seed: SEED, numRuns: NUM_RUNS };

const CEILING = 90000;
const RESERVE = 1000;
const INC = 100;
const bidders = [A, B, C] as const;

const bidStep = fc.record({
  who: fc.integer({ min: 0, max: 2 }),
  amount: fc.integer({ min: 1, max: 120000 }),
  dt: fc.integer({ min: 0, max: 1500 }),
});
type BidStep = { who: number; amount: number; dt: number };

function playLot(mode: Mode, steps: readonly BidStep[]): AuctionState[] {
  const lot = lotConfig(L1, {
    mode,
    reserveCents: RESERVE,
    increment: { flatCents: INC },
    softClose: { windowMs: 0, extensionMs: 0, maxExtensions: 0 },
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

const activeBids = (s: AuctionState): BidRecord[] =>
  (s.lots[L1]?.bids ?? []).filter((b) => b.status === 'active');

const pricingLot = (mode: Mode): PricingLot => ({
  mode,
  reserveCents: RESERVE,
  increment: { flatCents: INC },
});

describe('pricing properties', () => {
  it('R-ENG-026 a hammered lot has exactly one winner and price <= the winner ceiling', () => {
    for (const mode of ['english', 'proxy', 'second_price'] as const) {
      fc.assert(
        fc.property(fc.array(bidStep, { maxLength: 30 }), (steps) => {
          const last = playLot(mode, steps).at(-1);
          if (last === undefined) throw new Error('no state');
          const r = run(
            last,
            mk(9950, { type: 'Hammer', lotId: L1, early: true, actor: 'host:1' }),
          );
          const hammered = r.entries.filter((e) => e.type === 'LOT_HAMMERED');
          if (activeBids(last).length === 0) {
            expect(hammered).toHaveLength(0);
            expect(r.entries.map((e) => e.type)).toContain('LOT_UNSOLD');
            return;
          }
          expect(hammered).toHaveLength(1);
          const p = hammered[0]?.payload as { winnerId: string; priceCents: number };
          expect(bidders.map(String)).toContain(p.winnerId);
          expect(p.priceCents).toBeLessThanOrEqual(CEILING);
          expect(p.priceCents).toBeGreaterThanOrEqual(RESERVE);
        }),
        params,
      );
    }
  });

  it('R-ENG-026 a price above the available ceiling throws InvariantError', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 1, max: 1_000 }),
        (ceiling, extra) => {
          expect(() => assertWithinCeiling(ceiling, ceiling)).not.toThrow();
          expect(() => assertWithinCeiling(ceiling + extra, ceiling)).toThrow(InvariantError);
        },
      ),
      params,
    );
  });

  it('R-ENG-024 ranking is a total order, independent of insertion order', () => {
    const raw = fc.record({
      bidder: fc.integer({ min: 0, max: 5 }),
      amountCents: fc.integer({ min: 1, max: 3000 }),
      at: fc.integer({ min: 0, max: 50 }),
    });
    fc.assert(
      fc.property(
        fc.array(raw, { minLength: 1, maxLength: 30 }).chain((raws) =>
          fc.tuple(
            fc.constant(raws),
            fc.shuffledSubarray(
              raws.map((_, i) => i),
              {
                minLength: raws.length,
                maxLength: raws.length,
              },
            ),
          ),
        ),
        ([raws, order]) => {
          const bids: BidRecord[] = raws.map((r, i) => ({
            bidId: `id${i}`,
            bidderId: `b${r.bidder}`,
            amountCents: r.amountCents,
            at: r.at,
            seq: i,
            status: 'active',
          }));
          const shuffled = order.map((i) => bids[i] as BidRecord);
          const a = rank(bids);
          const b = rank(shuffled);
          expect(b).toEqual(a);
          for (let i = 1; i < a.length; i += 1) {
            const p = a[i - 1];
            const q = a[i];
            if (p === undefined || q === undefined) throw new Error('rank gap');
            const before =
              p.amountCents > q.amountCents ||
              (p.amountCents === q.amountCents &&
                (p.at < q.at || (p.at === q.at && p.seq < q.seq)));
            expect(before).toBe(true);
          }
          expect(new Set(a.map((r) => r.bidderId)).size).toBe(a.length);
        },
      ),
      params,
    );
  });

  it('R-ENG-017 english: the price is the highest active bid and never decreases', () => {
    fc.assert(
      fc.property(fc.array(bidStep, { maxLength: 30 }), (steps) => {
        let prev = 0;
        for (const s of playLot('english', steps)) {
          const active = activeBids(s);
          const price = englishPrice(pricingLot('english'), rank(active));
          if (active.length === 0) {
            expect(price).toBeNull();
            continue;
          }
          expect(price).toBe(Math.max(...active.map((b) => b.amountCents)));
          expect(price ?? 0).toBeGreaterThanOrEqual(prev);
          prev = price ?? 0;
        }
      }),
      params,
    );
  });

  it('R-ENG-019 proxy: reserve with one bidder, else max(reserve, min(top, second + inc))', () => {
    const maxes = fc.array(fc.integer({ min: RESERVE, max: 50000 }), {
      minLength: 1,
      maxLength: 6,
    });
    fc.assert(
      fc.property(maxes, (amounts) => {
        const bids: BidRecord[] = amounts.map((a, i) => ({
          bidId: `id${i}`,
          bidderId: `b${i}`,
          amountCents: a,
          at: i,
          seq: i,
          status: 'active',
        }));
        const ranked = rank(bids);
        const price = proxyPrice(pricingLot('proxy'), ranked);
        const top = ranked[0]?.amountCents ?? 0;
        const second = ranked[1]?.amountCents;
        if (second === undefined) {
          expect(price).toBe(RESERVE);
          return;
        }
        expect(price).toBe(Math.max(RESERVE, Math.min(top, second + INC)));
        expect(price ?? 0).toBeGreaterThanOrEqual(RESERVE);
        expect(price ?? 0).toBeLessThanOrEqual(top);
        expect(price ?? 0).toBeGreaterThanOrEqual(second);
      }),
      params,
    );
  });
});
