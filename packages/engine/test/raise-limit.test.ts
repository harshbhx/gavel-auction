import { describe, expect, it } from 'vitest';
import { A, B, L1, bid, errCode, mk, open, run, scene } from './decide-helpers.js';

// FEAT-61: a registered bidder can raise their limit while the lot is open. The ledger event is the
// existing CEILING_RAISED, so no event type and no hash input changed.
describe('raising a limit during an open lot', () => {
  it('T-ENG-032 R-ENG-041 keeps the lead, lifts the bidder over the old limit and never lowers it', () => {
    let s = open(scene(), L1);
    s = bid(s, 200, A, 80000).state;
    expect(s.lots[L1]?.leaderId).toBe(A);

    // Over the old limit of 90000: refused.
    expect(bid(s, 300, A, 95000).result.outcome).toMatchObject({ kind: 'rejected' });

    // The leader may not lower the limit, and an equal limit is not a raise.
    for (const c of [80000, 90000]) {
      expect(
        errCode(() => run(s, mk(310, { type: 'RegisterBidder', bidderId: A, ceilingCents: c }))),
      ).toBe('cannot_lower_ceiling');
    }

    const raised = run(s, mk(320, { type: 'RegisterBidder', bidderId: A, ceilingCents: 100000 }));
    expect(raised.entries.map((e) => e.type)).toEqual(['CEILING_RAISED']);
    expect(raised.state.lots[L1]?.leaderId).toBe(A);
    expect(raised.state.bidders[A]?.ceilingCents).toBe(100000);

    // After B outbids, A can answer above the old limit.
    let t = bid(raised.state, 400, B, 85000).state;
    t = bid(t, 500, A, 95000).state;
    expect(t.lots[L1]?.leaderId).toBe(A);
  });

  it('T-ENG-032 R-ENG-040 refuses a limit above the server cap', () => {
    const s = open(scene(), L1);
    expect(
      errCode(() =>
        run(s, mk(300, { type: 'RegisterBidder', bidderId: A, ceilingCents: 10_000_001 })),
      ),
    ).toBe('bad_ceiling');
  });

  it('T-ENG-032 R-ENG-040 UIX-59 a limit above $1000 registers and raises on the default cap', () => {
    const s = open(scene(), L1);
    const big = run(s, mk(300, { type: 'RegisterBidder', bidderId: A, ceilingCents: 250_000 }));
    expect(big.state.bidders[A]?.ceilingCents).toBe(250_000);
    const higher = run(
      big.state,
      mk(310, { type: 'RegisterBidder', bidderId: A, ceilingCents: 10_000_000 }),
    );
    expect(higher.entries.map((e) => e.type)).toEqual(['CEILING_RAISED']);
    expect(higher.state.bidders[A]?.ceilingCents).toBe(10_000_000);
  });
});
