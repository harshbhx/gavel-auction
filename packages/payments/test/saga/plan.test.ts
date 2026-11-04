import { describe, expect, it } from 'vitest';
import { planFromOutcome } from '../../src/saga/plan.js';
import type { HoldRef } from '../../src/types.js';

const hold = (id: string): HoldRef => ({
  holdId: id,
  authId: `auth-${id}`,
  ceilingCents: 20000,
  createdAtMs: 1,
});
const holds = { b1: hold('h1'), b2: hold('h2'), b3: hold('h3') };

describe('planFromOutcome', () => {
  it('prices the winner at the hammer price and runners-up at their own amount', () => {
    const plan = planFromOutcome(
      {
        auctionId: 'a1',
        price: 9000,
        ranking: [
          { bidderId: 'b1', amountCents: 12000 },
          { bidderId: 'b2', amountCents: 9000 },
          { bidderId: 'b3', amountCents: 5000 },
        ],
      },
      holds,
      1000,
    );
    expect(plan.auctionId).toBe('a1');
    expect(plan.reserveCents).toBe(1000);
    expect(plan.candidates).toEqual([
      { bidderId: 'b1', priceCents: 9000 },
      { bidderId: 'b2', priceCents: 9000 },
      { bidderId: 'b3', priceCents: 5000 },
    ]);
    expect(plan.holds).toEqual(holds);
  });

  it('returns no candidates for an empty ranking', () => {
    const plan = planFromOutcome({ auctionId: 'a1', price: 0, ranking: [] }, holds, 0);
    expect(plan.candidates).toEqual([]);
  });

  it('rejects a duplicate bidder', () => {
    expect(() =>
      planFromOutcome(
        {
          auctionId: 'a1',
          price: 100,
          ranking: [
            { bidderId: 'b1', amountCents: 100 },
            { bidderId: 'b1', amountCents: 90 },
          ],
        },
        holds,
        0,
      ),
    ).toThrow(/duplicate bidder/);
  });
});
