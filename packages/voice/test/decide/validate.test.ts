import { describe, expect, it } from 'vitest';
import { validate, type Verdict } from '../../src/decide/validate.js';
import type { BidContext, ParseResult } from '../../src/types.js';

function ctx(over: Partial<BidContext> = {}): BidContext {
  return {
    nowMs: 100000,
    lotState: 'OPEN',
    currentPriceCents: 30000,
    minIncrementCents: 2500,
    highBidderId: 'b-other',
    roster: new Map([
      ['12', { bidderId: 'b-12', ceilingCents: 1000000, holdActive: true }],
      ['7', { bidderId: 'b-7', ceilingCents: 1000000, holdActive: false }],
    ]),
    recent: [],
    ...over,
  };
}

function parse(over: Partial<ParseResult> = {}): ParseResult {
  return {
    status: 'bid',
    bidder: { kind: 'paddle', value: '12' },
    amountCents: 35000,
    reason: 'ok',
    candidates: [],
    flags: [],
    confidence: 0.95,
    source: 'rules',
    ...over,
  };
}

describe('T-VOX-072 validator (R-VOX-064)', () => {
  it('accepts a clean valid bid', () => {
    expect(validate(parse(), ctx())).toEqual({
      kind: 'accept',
      bidderId: 'b-12',
      amountCents: 35000,
    });
  });

  it('resolves a speaker bidder through the roster', () => {
    const p = parse({ bidder: { kind: 'speaker', value: 'b-12' } });
    expect(validate(p, ctx()).kind).toBe('accept');
  });

  const cases: Array<[string, ParseResult, BidContext, Verdict['kind'], string]> = [
    [
      'unregistered paddle',
      parse({ bidder: { kind: 'paddle', value: '99' } }),
      ctx(),
      'confirm',
      'unregistered_paddle',
    ],
    [
      'holdActive false',
      parse({ bidder: { kind: 'paddle', value: '7' } }),
      ctx(),
      'drop',
      'not_open',
    ],
    ['lot not open', parse(), ctx({ lotState: 'OTHER' }), 'drop', 'not_open'],
    ['equal to price', parse({ amountCents: 30000 }), ctx(), 'drop', 'below_minimum'],
    ['below price plus increment', parse({ amountCents: 31000 }), ctx(), 'drop', 'below_minimum'],
    [
      'above ceiling',
      parse({ amountCents: 1100000 }),
      ctx({ currentPriceCents: 900000 }),
      'drop',
      'above_ceiling',
    ],
    ['already high bidder', parse(), ctx({ highBidderId: 'b-12' }), 'drop', 'already_high_bidder'],
    [
      'duplicate in 3000 ms',
      parse(),
      ctx({ recent: [{ bidderId: 'b-12', amountCents: 35000, atMs: 97500 }] }),
      'drop',
      'duplicate',
    ],
    ['jump 5x', parse({ amountCents: 150000 }), ctx(), 'confirm', 'large_jump'],
    [
      'jump plus 1000 dollars',
      parse({ amountCents: 230000 }),
      ctx({ currentPriceCents: 130000 }),
      'confirm',
      'large_jump',
    ],
  ];

  it.each(cases)('%s', (_n, p, c, kind, reason) => {
    const v = validate(p, c);
    expect(v.kind).toBe(kind);
    if (v.kind !== 'accept') expect(v.reason).toBe(reason);
  });

  it('duplicate outside the window is not a duplicate', () => {
    const c = ctx({ recent: [{ bidderId: 'b-12', amountCents: 35000, atMs: 96999 }] });
    expect(validate(parse(), c).kind).toBe('accept');
  });

  it('at-or-below price with a higher homophone alternative downgrades to confirm', () => {
    const p = parse({
      amountCents: 25000,
      candidates: [
        { bidder: { kind: 'paddle', value: '12' }, amountCents: 25000 },
        { bidder: { kind: 'paddle', value: '12' }, amountCents: 35000 },
      ],
    });
    const v = validate(p, ctx());
    expect(v).toMatchObject({ kind: 'confirm', reason: 'homophone' });
  });

  it('keeps a confirm as a confirm and a none as a drop', () => {
    expect(validate(parse({ status: 'confirm', reason: 'homophone' }), ctx()).kind).toBe('confirm');
    expect(validate(parse({ status: 'none', reason: 'question' }), ctx())).toEqual({
      kind: 'drop',
      reason: 'question',
    });
  });

  it('never upgrades a non-bid to accept (random inputs)', () => {
    let seed = 99;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed;
    };
    const statuses = ['confirm', 'none'] as const;
    for (let i = 0; i < 2000; i++) {
      const p = parse({
        status: statuses[next() % 2] ?? 'none',
        amountCents: next() % 2000000,
        bidder: next() % 3 === 0 ? null : { kind: 'paddle', value: String(next() % 20) },
      });
      const c = ctx({
        currentPriceCents: next() % 500000,
        highBidderId: next() % 2 === 0 ? 'b-12' : null,
        lotState: next() % 4 === 0 ? 'OTHER' : 'OPEN',
      });
      expect(validate(p, c).kind).not.toBe('accept');
    }
  });
});

describe('T-VOX-073 confirm parse with candidates and no single amount (R7-02)', () => {
  const multi = (amounts: number[], reason: ParseResult['reason'] = 'multiple_amounts') =>
    parse({
      status: 'confirm',
      reason,
      amountCents: null,
      candidates: amounts.map((a) => ({ bidder: { kind: 'paddle', value: '12' }, amountCents: a })),
    });

  for (const reason of ['multiple_amounts', 'to_for_ambiguity', 'homophone'] as const) {
    it(`${reason}: both options reach the bidder as a confirm`, () => {
      const v = validate(multi([40000, 50000], reason), ctx());
      expect(v).toEqual({
        kind: 'confirm',
        reason,
        bidderId: 'b-12',
        amountCents: null,
        candidates: [40000, 50000],
      });
    });
  }

  it('keeps only the candidates that pass and names the single survivor', () => {
    const v = validate(multi([20000, 40000]), ctx());
    expect(v).toEqual({
      kind: 'confirm',
      reason: 'multiple_amounts',
      bidderId: 'b-12',
      amountCents: 40000,
      candidates: [40000],
    });
  });

  it('drops with the real reason only when no candidate survives', () => {
    expect(validate(multi([10000, 20000]), ctx())).toEqual({
      kind: 'drop',
      reason: 'below_minimum',
    });
    expect(validate(multi([2000000, 3000000]), ctx())).toEqual({
      kind: 'drop',
      reason: 'above_ceiling',
    });
  });

  it('still drops a confirm parse with no candidates at all as no_amount', () => {
    expect(validate(multi([]), ctx())).toEqual({ kind: 'drop', reason: 'no_amount' });
  });
});

describe('HRD-84 minimum applies per candidate', () => {
  const two = (reason: ParseResult['reason'], status: ParseResult['status'] = 'confirm') =>
    parse({
      status,
      reason,
      amountCents: 31000,
      candidates: [31000, 50000].map((a) => ({
        bidder: { kind: 'paddle', value: '12' },
        amountCents: a,
      })),
    });

  it('drops only the reading below the minimum and keeps the other as a confirm', () => {
    // price 30000, increment 2500: 31000 is below the minimum, 50000 is valid.
    const v = validate(two('homophone'), ctx());
    expect(v).toEqual({
      kind: 'confirm',
      reason: 'homophone',
      bidderId: 'b-12',
      amountCents: 50000,
      candidates: [50000],
    });
  });

  it('never accepts a multi-candidate utterance, even when one reading is clean', () => {
    expect(validate(two('multiple_amounts', 'bid'), ctx()).kind).not.toBe('accept');
  });

  it('drops the utterance only when no candidate remains', () => {
    const p = parse({
      status: 'confirm',
      reason: 'homophone',
      amountCents: 31000,
      candidates: [31000, 32000].map((a) => ({
        bidder: { kind: 'paddle', value: '12' },
        amountCents: a,
      })),
    });
    expect(validate(p, ctx())).toEqual({ kind: 'drop', reason: 'below_minimum' });
  });
});

describe('HRD-84 currency utterance keeps its own reason', () => {
  const currency = (bidder: ParseResult['bidder']) =>
    parse({ status: 'confirm', reason: 'unsupported_currency', amountCents: null, bidder });

  it('without a known bidder it is a confirm, not unknown_bidder', () => {
    expect(validate(currency(null), ctx())).toMatchObject({
      kind: 'confirm',
      reason: 'unsupported_currency',
      amountCents: null,
    });
  });

  it('with a known bidder it is a confirm, not a no_amount drop', () => {
    expect(validate(currency({ kind: 'paddle', value: '12' }), ctx())).toMatchObject({
      kind: 'confirm',
      reason: 'unsupported_currency',
      bidderId: 'b-12',
    });
  });
});
