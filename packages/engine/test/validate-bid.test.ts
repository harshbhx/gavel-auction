import { describe, expect, it } from 'vitest';
import { EngineError } from '../src/errors.js';
import { evolve } from '../src/evolve.js';
import type { LedgerEvent } from '../src/events.js';
import { REJECT_REASONS } from '../src/reasons.js';
import { MAX_AMOUNT_CENTS, validateBid } from '../src/rules/validate-bid.js';
import type { BidInput } from '../src/rules/validate-bid.js';
import { initialState } from '../src/state.js';
import type { AuctionState, LotState } from '../src/state.js';
import type { AuctionConfig, LotConfig, Ulid } from '../src/types.js';
import { entriesFrom } from './entries.js';

const id = (s: string): Ulid => s.padStart(26, '0') as Ulid;
const AU = id('AAA');
const L1 = id('M1');
const A = id('A');
const B = id('B');
const C = id('C');

function lotCfg(mode: LotConfig['mode'], over: Partial<LotConfig> = {}): LotConfig {
  return {
    lotId: L1,
    title: 'Vase',
    mode,
    reserveCents: 1000,
    increment: { flatCents: 100 },
    durationMs: 100000,
    softClose: { windowMs: 0, extensionMs: 0, maxExtensions: 3 },
    hammer: 'auto',
    ...over,
  };
}

function bidEv(bidder: Ulid, amount: number, bidId: string): LedgerEvent {
  return {
    type: 'BID_RECORDED',
    payload: {
      bidId,
      lotId: L1,
      bidderId: bidder,
      amountCents: amount,
      source: 'manual',
      audit: {},
      priceBefore: null,
      priceAfter: null,
      leaderBefore: null,
      leaderAfter: bidder,
      rank: 1,
      endsAtBefore: 100000,
      endsAtAfter: 100000,
    },
  };
}

function build(
  mode: LotConfig['mode'],
  extra: LedgerEvent[] = [],
  config: Partial<AuctionConfig> = {},
  open = true,
): { s: AuctionState; lot: LotState } {
  const evs: LedgerEvent[] = [
    { type: 'AUCTION_CREATED', payload: { title: 't', config } },
    { type: 'LOT_ADDED', payload: { lotId: L1, lot: lotCfg(mode) } },
    { type: 'BIDDER_REGISTERED', payload: { bidderId: A, ceilingCents: 50000 } },
    { type: 'BIDDER_REGISTERED', payload: { bidderId: B, ceilingCents: 50000 } },
    ...(open
      ? [{ type: 'LOT_OPENED', payload: { lotId: L1, endsAt: 100000 } } as LedgerEvent]
      : []),
    ...extra,
  ];
  const s = entriesFrom(evs.map((event, i) => ({ event, at: i }))).reduce(evolve, initialState);
  const lot = s.lots[L1];
  if (lot === undefined) throw new Error('no lot');
  return { s, lot };
}

const bid = (over: Partial<BidInput> = {}): BidInput => ({
  commandId: id('CMD'),
  auctionId: AU,
  lotId: L1,
  bidderId: A,
  amountCents: 1000,
  at: 10,
  source: 'manual',
  audit: {},
  ...over,
});

const reason = (r: ReturnType<typeof validateBid>): string => (r.ok ? 'ok' : r.reason);

describe('validateBid', () => {
  it('T-ENG-001 R-ENG-001: bad amounts are bad_amount', () => {
    const { s, lot } = build('english');
    for (const amt of [
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      MAX_AMOUNT_CENTS + 1,
      '500',
    ]) {
      expect(reason(validateBid(s, lot, bid({ amountCents: amt as number })))).toBe('bad_amount');
    }
    expect(reason(validateBid(s, lot, bid({ amountCents: 1000 })))).toBe('ok');
  });

  it('T-ENG-005 R-ENG-005: malformed ids throw bad_id', () => {
    const { s, lot } = build('english');
    for (const o of [
      { bidderId: 'alice' },
      { lotId: '' },
      { commandId: id('CMD').toLowerCase() },
    ]) {
      expect(() => validateBid(s, lot, bid(o as Partial<BidInput>))).toThrow(EngineError);
    }
    try {
      validateBid(s, lot, bid({ bidderId: 'alice' as Ulid }));
    } catch (e) {
      expect((e as EngineError).code).toBe('bad_id');
    }
  });

  it('T-ENG-022 R-ENG-027: first failure in normative order', () => {
    const closed = build('english', [], {}, false);
    expect(reason(validateBid(closed.s, closed.lot, bid({ bidderId: C, amountCents: 0 })))).toBe(
      'lot_not_open',
    );
    const open = build('english', [
      { type: 'CEILING_REVOKED', payload: { bidderId: B, reason: 'declined' } },
    ]);
    expect(reason(validateBid(open.s, open.lot, bid({ bidderId: C, amountCents: 0 })))).toBe(
      'unregistered',
    );
    expect(reason(validateBid(open.s, open.lot, bid({ bidderId: B, amountCents: 0 })))).toBe(
      'ceiling_revoked',
    );
    expect(reason(validateBid(open.s, open.lot, bid({ amountCents: 0 })))).toBe('bad_amount');
  });

  it('R-ENG-035: bid at endsAt - 1 is accepted, at endsAt is lot_not_open', () => {
    const { s, lot } = build('english');
    expect(reason(validateBid(s, lot, bid({ at: 99999 })))).toBe('ok');
    expect(reason(validateBid(s, lot, bid({ at: 100000 })))).toBe('lot_not_open');
  });

  it('T-ENG-031 R-ENG-042: ceiling boundary', () => {
    const { s, lot } = build('english');
    expect(reason(validateBid(s, lot, bid({ amountCents: 50001 })))).toBe('over_ceiling');
    expect(reason(validateBid(s, lot, bid({ amountCents: 50000 })))).toBe('ok');
  });

  it('T-ENG-023 R-ENG-030: voice confirmation', () => {
    const { s, lot } = build('english');
    const voice = (audit: BidInput['audit']) => bid({ source: 'voice', audit });
    expect(reason(validateBid(s, lot, voice({ confidenceBps: 8499 })))).toBe('unconfirmed');
    expect(reason(validateBid(s, lot, voice({ confidenceBps: 8499, confirmed: true })))).toBe('ok');
    expect(reason(validateBid(s, lot, voice({ confidenceBps: 8500 })))).toBe('ok');
    expect(reason(validateBid(s, lot, bid({ source: 'qr', audit: { confidenceBps: 10 } })))).toBe(
      'ok',
    );
  });

  it('ENG-RT-02: a voice bid with no confidence fails closed', () => {
    const { s, lot } = build('english');
    expect(reason(validateBid(s, lot, bid({ source: 'voice', audit: {} })))).toBe('unconfirmed');
    expect(reason(validateBid(s, lot, bid({ source: 'voice', audit: { confirmed: true } })))).toBe(
      'ok',
    );
  });

  it('below_reserve before mode rules', () => {
    const { s, lot } = build('english');
    expect(reason(validateBid(s, lot, bid({ amountCents: 999 })))).toBe('below_reserve');
  });

  it('english: below_increment then already_leading', () => {
    const { s, lot } = build('english', [bidEv(A, 1000, 'b1')]);
    expect(reason(validateBid(s, lot, bid({ bidderId: B, amountCents: 1050 })))).toBe(
      'below_increment',
    );
    expect(reason(validateBid(s, lot, bid({ bidderId: B, amountCents: 1100 })))).toBe('ok');
    expect(reason(validateBid(s, lot, bid({ bidderId: A, amountCents: 1050 })))).toBe(
      'below_increment',
    );
    expect(reason(validateBid(s, lot, bid({ bidderId: A, amountCents: 1100 })))).toBe(
      'already_leading',
    );
  });

  it('proxy: own maximum must rise', () => {
    const { s, lot } = build('proxy', [bidEv(A, 3000, 'b1')]);
    expect(reason(validateBid(s, lot, bid({ amountCents: 3000 })))).toBe('not_higher_than_own_max');
    expect(reason(validateBid(s, lot, bid({ amountCents: 3001 })))).toBe('ok');
  });

  it('second_price: one bid per bidder', () => {
    const { s, lot } = build('second_price', [bidEv(A, 3000, 'b1')]);
    expect(reason(validateBid(s, lot, bid({ amountCents: 4000 })))).toBe('already_bid');
    expect(reason(validateBid(s, lot, bid({ bidderId: B, amountCents: 4000 })))).toBe('ok');
  });

  it('R-ENG-028: every reject reason produced is a member of REJECT_REASONS', () => {
    const { s, lot } = build('english', [bidEv(A, 1000, 'b1')]);
    const r = validateBid(s, lot, bid({ amountCents: 1 }));
    expect(r.ok ? '' : (REJECT_REASONS as readonly string[]).includes(r.reason)).toBe(true);
  });
});
