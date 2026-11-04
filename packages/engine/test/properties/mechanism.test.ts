import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { hammerPrice, currentPrice } from '../../src/rules/pricing-basic.js';
import type { PricingLot } from '../../src/rules/pricing-basic.js';
import { rank } from '../../src/rules/ranking.js';
import type { BidRecord } from '../../src/rules/ranking.js';

// These are toy-model checks of the mechanism logic. They say nothing about how real bidders behave.
// Seeded ports of reference/python/test_properties.py; set GAVEL_PROPERTY_SEED to replay.
const SEED = Number(process.env['GAVEL_PROPERTY_SEED'] ?? 20261104);
const NUM_RUNS = Number(process.env['GAVEL_PROPERTY_RUNS'] ?? 500);
const params = { seed: SEED, numRuns: NUM_RUNS };

const sealedLot = (reserveCents: number): PricingLot => ({
  mode: 'second_price',
  reserveCents,
  increment: { flatCents: 1 },
});

interface Outcome {
  winner: string | null;
  price: number;
}

/** One sealed bid per bidder; bids below the reserve are rejected, as the engine does. */
function sealed(
  bids: ReadonlyArray<{ bidder: string; amount: number; at: number }>,
  reserve: number,
): Outcome {
  const records: BidRecord[] = bids
    .filter((b) => b.amount >= reserve)
    .map((b, i) => ({
      bidId: `id${i}`,
      bidderId: b.bidder,
      amountCents: b.amount,
      at: b.at,
      seq: i,
      status: 'active',
    }));
  const ranked = rank(records);
  const price = hammerPrice(sealedLot(reserve), ranked);
  return { winner: ranked[0]?.bidderId ?? null, price: price ?? 0 };
}

const utility = (o: Outcome, who: string, value: number): number =>
  o.winner === who ? value - o.price : 0;

describe('mechanism properties (toy models)', () => {
  it('R-ENG-023 second price: price is max(reserve, second highest), reserve with one bidder, null before hammer', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 5000 }), { minLength: 1, maxLength: 8 }),
        fc.integer({ min: 1, max: 2000 }),
        (amounts, reserve) => {
          const bids = amounts.map((amount, i) => ({ bidder: `b${i}`, amount, at: i }));
          const valid = amounts.filter((a) => a >= reserve).sort((x, y) => y - x);
          const o = sealed(bids, reserve);
          if (valid.length === 0) {
            expect(o.winner).toBeNull();
            return;
          }
          expect(o.price).toBe(valid.length === 1 ? reserve : Math.max(reserve, valid[1] ?? 0));
          const records = valid.map((a, i) => ({
            bidId: `x${i}`,
            bidderId: `b${i}`,
            amountCents: a,
            at: i,
            seq: i,
            status: 'active' as const,
          }));
          expect(currentPrice(sealedLot(reserve), rank(records))).toBeNull();
        },
      ),
      params,
    );
  });

  it('T-ENG-069 R-ENG-097 second price outcome is invariant under bid arrival order', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: 5000 }), { minLength: 2, maxLength: 8 }),
        fc.integer({ min: 1, max: 2000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        (amounts, reserve, shuffleSeed) => {
          const bids = amounts.map((amount, i) => ({ bidder: `b${i}`, amount, at: i * 10 }));
          const base = sealed(bids, reserve);
          // 100 seeded permutations of the arrival order, each bid keeping its own timestamp.
          let state = shuffleSeed + 1;
          const next = (): number => {
            state = (state * 1103515245 + 12345) % 2147483648;
            return state;
          };
          for (let p = 0; p < 100; p += 1) {
            const perm = [...bids];
            for (let i = perm.length - 1; i > 0; i -= 1) {
              const j = next() % (i + 1);
              const t = perm[i];
              const u = perm[j];
              if (t === undefined || u === undefined) throw new Error('perm');
              perm[i] = u;
              perm[j] = t;
            }
            expect(sealed(perm, reserve)).toEqual(base);
          }
        },
      ),
      { ...params, numRuns: Math.max(50, Math.floor(NUM_RUNS / 5)) },
    );
  });

  it('vickrey: bidding the true value is weakly dominant', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }),
        fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 5 }),
        fc.integer({ min: 1, max: 300 }),
        fc.array(fc.integer({ min: 1, max: 1500 }), { minLength: 1, maxLength: 5 }),
        (value, rivalAmounts, reserve, deviations) => {
          const rivals = rivalAmounts.map((amount, i) => ({ bidder: `r${i}`, amount, at: i + 1 }));
          const play = (amount: number): number =>
            utility(sealed([{ bidder: 'me', amount, at: 0 }, ...rivals], reserve), 'me', value);
          const truthful = play(value);
          for (const dev of [...deviations, Math.max(1, value - 1), value + 1, 1, 1_000_000]) {
            expect(play(dev)).toBeLessThanOrEqual(truthful);
          }
        },
      ),
      params,
    );
  });

  it('vickrey: tie at the top goes to the earlier bid and a raise cannot profit', () => {
    const tie = sealed(
      [
        { bidder: 'me', amount: 500, at: 1 },
        { bidder: 'x', amount: 500, at: 0 },
      ],
      1,
    );
    expect(utility(tie, 'me', 500)).toBe(0);
    const win = sealed(
      [
        { bidder: 'x', amount: 500, at: 0 },
        { bidder: 'me', amount: 600, at: 1 },
      ],
      1,
    );
    expect(win).toEqual({ winner: 'me', price: 500 });
  });

  it('ascending clock ends within one increment of the second highest value', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 150, max: 900 }), { minLength: 2, maxLength: 5 }),
        (values) => {
          const inc = 5;
          const reserve = 100;
          let price = reserve - inc;
          let leader = -1;
          let active = true;
          while (active) {
            active = false;
            for (let i = 0; i < values.length; i += 1) {
              const v = values[i] ?? 0;
              if (i !== leader && price + inc <= v) {
                price += inc;
                leader = i;
                active = true;
              }
            }
          }
          const sorted = [...values].sort((a, b) => b - a);
          const top = sorted[0] ?? 0;
          const runnerUp = sorted[1] ?? 0;
          // On the increment grid the runner-up can win when the top two are within one increment.
          if (top - runnerUp >= inc) expect(values[leader]).toBe(top);
          else expect(values[leader] ?? 0).toBeGreaterThanOrEqual(runnerUp);
          expect(price).toBeGreaterThan(runnerUp - inc);
          expect(price).toBeLessThanOrEqual(runnerUp + inc);
        },
      ),
      params,
    );
  });
});
