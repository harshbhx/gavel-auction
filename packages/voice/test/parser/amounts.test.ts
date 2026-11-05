import { describe, expect, it } from 'vitest';
import { parseBid } from '../../src/parser/parse.js';
import { findNumberSpans, tokenize } from '../../src/parser/normalize.js';

const ctx = { speakerBidderId: '7' };

function bid(text: string): number | null {
  const r = parseBid(text, ctx);
  return r.status === 'bid' ? r.amountCents : null;
}

describe('T-VOX-038 numerals (R-VOX-038)', () => {
  const rows: Array<[string, number]> = [
    ['350', 35000],
    ['$2,500', 250000],
    ['1,500', 150000],
    ['1500', 150000],
    ['1.5k', 150000],
    ['$4.5K', 450000],
    ['12k', 1200000],
    ['350.00', 35000],
    ['I will bid $350', 35000],
    ['3 hundred', 30000],
  ];
  for (const [text, cents] of rows) {
    it(`"${text}" is ${cents}`, () => {
      expect(bid(text)).toBe(cents);
    });
  }

  it('"350.50" asks to confirm with the exact cents as the only candidate', () => {
    const r = parseBid('350.50', ctx);
    expect(r.status).toBe('confirm');
    expect(r.reason).toBe('fractional_amount');
    expect(r.amountCents).toBe(35050);
    expect(r.candidates.map((c) => c.amountCents)).toEqual([35050]);
  });
});

describe('T-VOX-039 currency (R-VOX-039)', () => {
  for (const text of [
    '350 bucks',
    '350 buck',
    'USD 350',
    '350 US dollars',
    'three fifty dollars',
    '350 dollar',
  ]) {
    it(`"${text}" is a 35000 bid`, () => {
      expect(bid(text)).toBe(35000);
    });
  }

  for (const text of [
    '350 pounds',
    'three fifty rupees',
    'two lakh',
    '350 euros',
    '350 quid',
    '350 rs',
    '5000 pesos',
    '300 yen',
  ]) {
    it(`"${text}" is confirm unsupported_currency, not converted`, () => {
      const r = parseBid(text, ctx);
      expect(r.status).toBe('confirm');
      expect(r.reason).toBe('unsupported_currency');
      expect(r.amountCents).toBeNull();
      expect(r.candidates).toEqual([]);
    });
  }

  it('"N dollars M cents" is N*100+M cents, and a part-dollar amount is confirmed', () => {
    for (const [text, cents] of [
      ['five dollars fifty cents', 550],
      ['350 dollars 25 cents', 35025],
      ['paddle seven three hundred dollars and fifty cents', 30050],
      ['paddle seven five hundred bucks and twenty five cents', 50025],
    ] as const) {
      const r = parseBid(text, ctx);
      expect(r.amountCents).toBe(cents);
      expect(r.status).toBe('confirm');
      expect(r.reason).toBe('fractional_amount');
      expect(r.candidates.map((c) => c.amountCents)).toEqual([cents]);
    }
  });

  it('"fifty cents" alone is fractional, never a bid', () => {
    const r = parseBid('fifty cents', ctx);
    expect(r.status).toBe('confirm');
    expect(r.reason).toBe('fractional_amount');
    expect(r.amountCents).toBe(50);
  });
});

describe('T-VOX-058 currency symbols', () => {
  it('$350 is accepted', () => {
    expect(bid('$350')).toBe(35000);
  });
  for (const text of ['£350', '350 EUR sign', '₹350', '€350']) {
    it(`"${text}" is confirm unsupported_currency`, () => {
      const r = parseBid(text, ctx);
      expect(r.status).toBe('confirm');
      expect(r.reason).toBe('unsupported_currency');
    });
  }
});

describe('amount selection', () => {
  it('spoken amounts with the speaker as bidder', () => {
    const r = parseBid('I will go four hundred and fifty', ctx);
    expect(r.status).toBe('bid');
    expect(r.amountCents).toBe(45000);
    expect(r.bidder).toEqual({ kind: 'speaker', value: '7' });
    expect(r.source).toBe('rules');
  });

  it('flags colloquial hundreds', () => {
    expect(parseBid('two fifty', ctx).flags).toEqual(['colloquial_hundreds']);
    expect(parseBid('two hundred fifty', ctx).flags).toEqual([]);
  });

  it('an interjected "oh" is not a zero', () => {
    expect(bid('oh three hundred')).toBe(30000);
    expect(bid('two oh five')).toBe(20500);
  });

  it('extended spoken forms', () => {
    expect(bid('a hundred and twenty')).toBe(12000);
    expect(bid('two and a half thousand')).toBe(250000);
    expect(bid('a grand')).toBe(100000);
  });

  it('two different amounts need confirmation with both candidates', () => {
    const r = parseBid('two fifty or three hundred', ctx);
    expect(r.status).toBe('confirm');
    expect(r.reason).toBe('multiple_amounts');
    expect(r.candidates.map((c) => c.amountCents)).toEqual([25000, 30000]);
  });

  it('the same amount said twice is one amount', () => {
    expect(bid('three hundred I said three hundred')).toBe(30000);
  });

  it('a number it cannot read needs confirmation', () => {
    const r = parseBid('two twenty fifty', ctx);
    expect(r.status).toBe('confirm');
    expect(r.reason).toBe('uninterpretable_number');
  });

  it('no speaker and no paddle asks who', () => {
    const r = parseBid('three hundred');
    expect(r.status).toBe('confirm');
    expect(r.reason).toBe('unknown_bidder');
    expect(r.amountCents).toBe(30000);
  });

  it('no number is none', () => {
    expect(parseBid('nice vase', ctx).reason).toBe('no_amount');
    expect(parseBid('', ctx).reason).toBe('empty');
    expect(parseBid('   ', ctx).reason).toBe('empty');
  });
});

describe('R-VOX-035 total and deterministic', () => {
  const nasty = [
    '\u0000\u0001',
    '$$$$$$',
    '1,,,,500',
    '....',
    '9'.repeat(400),
    '1.' + '9'.repeat(400),
    'k k k k',
    'point point point',
    'a a a a hundred',
    'and and and',
    'constructor __proto__ toString',
    'three '.repeat(300),
    '\ud800',
    'İİİ three hundred',
  ];
  for (const text of nasty) {
    it(`never throws on ${JSON.stringify(text.slice(0, 20))}`, () => {
      const a = parseBid(text, ctx);
      expect(['bid', 'confirm', 'none']).toContain(a.status);
      expect(parseBid(text, ctx)).toEqual(a);
    });
  }

  it('handles 2000 characters and rejects more', () => {
    expect(parseBid('say three hundred '.repeat(111).slice(0, 2000), ctx).status).toBe('bid');
    expect(parseBid('x'.repeat(2001), ctx).reason).toBe('too_long');
  });
});

describe('tokenize and findNumberSpans', () => {
  it('keeps offsets into the original text', () => {
    const t = tokenize('Paddle 12, $1,500!');
    expect(t.map((x) => x.text)).toEqual(['paddle', '12', '$', '1500']);
    expect(t[3]).toEqual({ text: '1500', start: 12, end: 17 });
  });

  it('joins and, and-a-half and article', () => {
    expect(findNumberSpans('four hundred and fifty now'.split(' '))).toEqual([[0, 4]]);
    expect(findNumberSpans('two and a half thousand'.split(' '))).toEqual([[0, 5]]);
    expect(findNumberSpans('i bid a hundred'.split(' '))).toEqual([[2, 4]]);
    expect(findNumberSpans('five and six'.split(' '))).toEqual([[0, 3]]);
  });
});
