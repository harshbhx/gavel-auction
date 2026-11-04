import { describe, expect, it } from 'vitest';
import { evolve } from '../src/evolve.js';
import { EngineError } from '../src/errors.js';
import type { LedgerEntry, LedgerEvent } from '../src/events.js';
import { initialState } from '../src/state.js';
import type { AuctionState } from '../src/state.js';
import { entriesFrom } from './entries.js';
import type { LotConfig, Ulid } from '../src/types.js';

const u = (s: string): Ulid => s as Ulid;
const A = u('A');
const B = u('B');
const L1 = u('L1');
const lot: LotConfig = {
  lotId: L1,
  title: 'Vase',
  mode: 'english',
  reserveCents: 1000,
  increment: { flatCents: 100 },
  durationMs: 100000,
  softClose: { windowMs: 30000, extensionMs: 30000, maxExtensions: 3 },
  hammer: 'auto',
};

const events: Array<{ event: LedgerEvent; at: number; cmd?: string }> = [
  { at: 1, cmd: 'c1', event: { type: 'AUCTION_CREATED', payload: { title: 'Gala', config: {} } } },
  { at: 2, event: { type: 'LOT_ADDED', payload: { lotId: L1, lot } } },
  {
    at: 3,
    event: {
      type: 'BIDDER_REGISTERED',
      payload: { bidderId: A, ceilingCents: 50000, holdRef: 'AUTH-1' },
    },
  },
  { at: 4, event: { type: 'BIDDER_REGISTERED', payload: { bidderId: B, ceilingCents: 40000 } } },
  { at: 5, event: { type: 'LOT_OPENED', payload: { lotId: L1, endsAt: 100005 } } },
  {
    at: 10,
    event: {
      type: 'BID_RECORDED',
      payload: {
        bidId: 'b1',
        lotId: L1,
        bidderId: A,
        amountCents: 1000,
        source: 'manual',
        audit: {},
        priceBefore: null,
        priceAfter: 1000,
        leaderBefore: null,
        leaderAfter: A,
        rank: 1,
        endsAtBefore: 100005,
        endsAtAfter: 100005,
      },
    },
  },
  {
    at: 20,
    event: {
      type: 'BID_RECORDED',
      payload: {
        bidId: 'b2',
        lotId: L1,
        bidderId: B,
        amountCents: 1500,
        source: 'manual',
        audit: {},
        priceBefore: 1000,
        priceAfter: 1500,
        leaderBefore: A,
        leaderAfter: B,
        rank: 1,
        endsAtBefore: 100005,
        endsAtAfter: 100005,
      },
    },
  },
  { at: 100005, event: { type: 'LOT_CLOSING', payload: { lotId: L1, reason: 'deadline' } } },
  {
    at: 100006,
    event: {
      type: 'LOT_HAMMERED',
      payload: {
        lotId: L1,
        winnerId: B,
        priceCents: 1500,
        mode: 'english',
        ranking: [],
        candidates: [
          { bidderId: B, priceCents: 1500 },
          { bidderId: A, priceCents: 1000 },
        ],
        endsAt: 100005,
        extensions: 0,
        closedAtSeq: 8,
      },
    },
  },
  {
    at: 100007,
    event: {
      type: 'FALLBACK_PROMOTED',
      payload: { lotId: L1, from: B, to: A, priceCents: 1000, depth: 1, reason: 'declined' },
    },
  },
  {
    at: 100008,
    event: {
      type: 'LOT_SETTLED',
      payload: { lotId: L1, winnerId: A, capturedCents: 1000, ref: 'r' },
    },
  },
  { at: 100009, event: { type: 'AUCTION_CLOSED', payload: { headHash: 'h11' } } },
];

describe('evolve', () => {
  const entries = entriesFrom(events);

  it('T-ENG-148 R-ENG-006 ENG-RT-13 keyed state maps have no prototype', () => {
    const entries = entriesFrom(events);
    const s = entries.reduce(evolve, initialState);
    for (const m of [s.lots, s.bidders, s.commands]) {
      expect(Object.getPrototypeOf(m)).toBeNull();
      expect(m['constructor']).toBeUndefined();
      expect(m['__proto__']).toBeUndefined();
    }
    expect(Object.keys(s.lots)).toContain(L1);
    expect(Object.getPrototypeOf(initialState.lots)).toBeNull();
  });

  it('R-ENG-092: state equals the reduction of the ledger and does not mutate inputs', () => {
    const frozen = JSON.stringify(initialState);
    const full = entries.reduce(evolve, initialState);
    expect(JSON.stringify(initialState)).toBe(frozen);
    const again = entries.reduce(evolve, initialState);
    expect(again).toStrictEqual(full);
    expect(full.head.seq).toBe(entries.length);
    expect(full.closed).toBe(true);
  });

  it('T-ENG-065 R-ENG-092: every prefix reduces the same incrementally and from scratch', () => {
    let live: AuctionState = initialState;
    entries.forEach((e, i) => {
      live = evolve(live, e);
      expect(live).toStrictEqual(entries.slice(0, i + 1).reduce(evolve, initialState));
    });
  });

  it('R-ENG-095: covers lot lifecycle, ranking index and fallback', () => {
    const mid = entries.slice(0, 7).reduce(evolve, initialState);
    expect(mid.lots['L1']?.leaderId).toBe(B);
    expect(mid.lots['L1']?.best['A']?.amountCents).toBe(1000);
    const end = entries.reduce(evolve, initialState);
    const l = end.lots['L1'];
    expect(l?.status).toBe('DONE');
    expect(l?.winnerId).toBe(A);
    expect(l?.priceCents).toBe(1000);
    expect(l?.demoted).toEqual([B]);
    expect(end.bidders['A']?.holdRef).toBe('AUTH-1');
  });

  it('R-ENG-044: BID_STRUCK removes the bid from ranking but keeps it recorded', () => {
    const struck = entriesFrom([
      ...events.slice(0, 7),
      { at: 30, event: { type: 'CEILING_REVOKED', payload: { bidderId: B, reason: 'declined' } } },
      {
        at: 30,
        event: {
          type: 'BID_STRUCK',
          payload: { bidId: 'b2', lotId: L1, bidderId: B, reason: 'revoked' },
        },
      },
    ]).reduce(evolve, initialState);
    expect(struck.lots['L1']?.leaderId).toBe(A);
    expect(struck.lots['L1']?.bids).toHaveLength(2);
    expect(struck.bidders['B']?.revoked).toBe(true);
  });

  it('T-ENG-067 R-ENG-095: unknown entry type throws unknown_entry_type', () => {
    const bad = { ...(entries[0] as LedgerEntry), type: 'FOO' } as unknown as LedgerEntry;
    expect(() => evolve(initialState, bad)).toThrow(EngineError);
    try {
      evolve(initialState, bad);
    } catch (e) {
      expect((e as EngineError).code).toBe('unknown_entry_type');
    }
  });
});
