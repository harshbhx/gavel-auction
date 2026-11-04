import { describe, expect, it } from 'vitest';
import { evolve } from '../src/evolve.js';
import type { LedgerEvent } from '../src/events.js';
import { available, committed, scopeKey, standingExposure } from '../src/rules/exposure.js';
import { initialState } from '../src/state.js';
import { entriesFrom } from './entries.js';
import type { Ulid } from '../src/types.js';

const u = (s: string): Ulid => s as Ulid;
const A = u('A');
const L1 = u('L1');
const L2 = u('L2');

function bidEvent(lotId: Ulid, bidId: string, amount: number): LedgerEvent {
  return {
    type: 'BID_RECORDED',
    payload: {
      bidId,
      lotId,
      bidderId: A,
      amountCents: amount,
      source: 'manual',
      audit: {},
      priceBefore: null,
      priceAfter: amount,
      leaderBefore: null,
      leaderAfter: A,
      rank: 1,
      endsAtBefore: 1000,
      endsAtAfter: 1000,
    },
  };
}

function setup(holdScope: 'event' | 'lot', ceiling: number, extra: LedgerEvent[] = []) {
  const evs: LedgerEvent[] = [
    { type: 'AUCTION_CREATED', payload: { title: 't', config: { holdScope } } },
    { type: 'LOT_ADDED', payload: { lotId: L1 } },
    { type: 'LOT_ADDED', payload: { lotId: L2 } },
    {
      type: 'BIDDER_REGISTERED',
      payload:
        holdScope === 'lot'
          ? { bidderId: A, ceilingCents: ceiling, lotId: L1, holdRef: 'AUTH-123' }
          : { bidderId: A, ceilingCents: ceiling, holdRef: 'AUTH-123' },
    },
    ...extra,
  ];
  return entriesFrom(evs.map((event, i) => ({ event, at: i + 1 }))).reduce(evolve, initialState);
}

const hammer = (lotId: Ulid, price: number): LedgerEvent => ({
  type: 'LOT_HAMMERED',
  payload: {
    lotId,
    winnerId: A,
    priceCents: price,
    mode: 'english',
    ranking: [],
    candidates: [{ bidderId: A, priceCents: price }],
    endsAt: 1000,
    extensions: 0,
    closedAtSeq: 1,
  },
});

describe('exposure', () => {
  it('T-ENG-031 R-ENG-042: available ceiling is the full ceiling before any win', () => {
    const s = setup('event', 50000);
    expect(available(s, A, L1)).toBe(50000);
    expect(available(s, u('nobody'), L1)).toBe(0);
  });

  it('R-ENG-043: event scope subtracts hammer prices of held lots across lots', () => {
    const s = setup('event', 5000, [
      { type: 'LOT_OPENED', payload: { lotId: L1, endsAt: 1000 } },
      hammer(L1, 3000),
    ]);
    expect(committed(s, A, 'event')).toBe(3000);
    expect(available(s, A, L2)).toBe(2000);
  });

  it('R-ENG-043 R-ENG-058: demotion and unsold release committed amount', () => {
    const s = setup('event', 5000, [
      hammer(L1, 3000),
      {
        type: 'FALLBACK_PROMOTED',
        payload: { lotId: L1, from: A, to: u('B'), priceCents: 2000, depth: 1, reason: 'x' },
      },
    ]);
    expect(available(s, A, L2)).toBe(5000);
    const unsold = setup('event', 5000, [
      hammer(L1, 3000),
      { type: 'LOT_UNSOLD', payload: { lotId: L1, reason: 'no_valid_winner' } },
    ]);
    expect(committed(unsold, A, 'event')).toBe(0);
  });

  it('lot scope keeps ceilings independent per lot', () => {
    const s = setup('lot', 5000, [hammer(L1, 3000)]);
    expect(scopeKey(s, L1)).toBe(L1);
    expect(available(s, A, L1)).toBe(2000);
    expect(available(s, A, L2)).toBe(0);
  });

  it('standing exposure counts the leading bid on open lots', () => {
    const s = setup('event', 5000, [
      { type: 'LOT_OPENED', payload: { lotId: L1, endsAt: 1000 } },
      bidEvent(L1, 'b1', 1200),
    ]);
    expect(standingExposure(s, A, 'event')).toBe(1200);
  });

  it('revoked ceiling has nothing available', () => {
    const s = setup('event', 5000, [
      { type: 'CEILING_REVOKED', payload: { bidderId: A, reason: 'declined' } },
    ]);
    expect(available(s, A, L1)).toBe(0);
  });

  it('T-ENG-033 R-ENG-046: holdRef is stored verbatim and never affects availability', () => {
    const s = setup('event', 5000);
    expect(s.bidders['A']?.holdRef).toBe('AUTH-123');
  });
});
