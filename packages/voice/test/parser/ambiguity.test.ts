import { describe, expect, it } from 'vitest';
import { parseBidChecked } from '../../src/parser/ambiguity.js';
import { computeSpans } from '../../src/parser/spans.js';

const ctx = { speakerBidderId: '7' };

describe('T-VOX-048 homophones (R-VOX-048)', () => {
  it('price 24000: "two fifteen" is confirm with both readings', () => {
    const r = parseBidChecked('two fifteen', { ...ctx, currentPriceCents: 24000 });
    expect(r.status).toBe('confirm');
    expect(r.reason).toBe('homophone');
    expect(r.candidates.map((c) => c.amountCents)).toEqual([21500, 25000]);
  });

  it('price 10000: "two fifteen" is a bid for 21500', () => {
    const r = parseBidChecked('two fifteen', { ...ctx, currentPriceCents: 10000 });
    expect(r.status).toBe('bid');
    expect(r.amountCents).toBe(21500);
  });

  it('price 4000: "fifteen" is confirm; price 6000: "eighty" is a bid for 8000', () => {
    expect(parseBidChecked('fifteen', { ...ctx, currentPriceCents: 4000 }).status).toBe('confirm');
    const r = parseBidChecked('eighty', { ...ctx, currentPriceCents: 6000 });
    expect(r.status).toBe('bid');
    expect(r.amountCents).toBe(8000);
  });

  it('without a known price nothing is flagged', () => {
    expect(parseBidChecked('two fifteen', ctx).status).toBe('bid');
  });
});

describe('T-VOX-049 multiples and spans (R-VOX-049)', () => {
  it('flags multiple amounts, multiple bidders and uninterpretable numbers', () => {
    expect(parseBidChecked('two fifty or three hundred', ctx).reason).toBe('multiple_amounts');
    expect(parseBidChecked('bidder 2 five hundred bidder 3 five fifty', ctx).reason).toBe(
      'multiple_bidders',
    );
    expect(parseBidChecked('two twenty fifty', ctx).status).toBe('confirm');
    const none = parseBidChecked('nice vase', ctx);
    expect(none.status).toBe('none');
    expect(none.reason).toBe('no_amount');
  });

  it('T-VOX-060: odd spans', () => {
    expect(parseBidChecked('two hundred fifty three', ctx).amountCents).toBe(25300);
    expect(parseBidChecked('one one one', ctx).status).toBe('confirm');
  });
});

describe('T-VOX-051 implausible amounts (R-VOX-051)', () => {
  for (const text of ['zero', '0', 'fifty cents', 'ten million', '$99999999999']) {
    it(`"${text}" -> confirm`, () => {
      const r = parseBidChecked(text, ctx);
      expect(r.status).toBe('confirm');
      expect(r.reason).toBe('implausible_amount');
    });
  }

  it('does not flag the bounds themselves', () => {
    expect(parseBidChecked('one dollar', ctx).status).toBe('bid');
    expect(parseBidChecked('$1,000,000', ctx).status).toBe('bid');
  });
});

describe('T-VOX-053 spans (R-VOX-053)', () => {
  it('slices the original text for paddle and amount', () => {
    const text = 'paddle twelve, three fifty dollars';
    const spans = computeSpans(text);
    expect(spans.map((s) => [s.kind, text.slice(s.start, s.end)])).toEqual([
      ['paddle', 'paddle twelve'],
      ['amount', 'three fifty'],
    ]);
  });

  it('covers a whole digit token including the symbol', () => {
    const text = 'I bid $1,500 now';
    const [s] = computeSpans(text);
    expect(s && text.slice(s.start, s.end)).toBe('$1,500');
  });

  it('T-VOX-062: offsets are valid with apostrophes and capitals', () => {
    const text = 'I\u2019LL GO Paddle Nine, Two Fifty';
    const spans = computeSpans(text);
    expect(spans.map((s) => text.slice(s.start, s.end))).toEqual(['Paddle Nine', 'Two Fifty']);
  });

  it('is attached to the parser result', () => {
    const r = parseBidChecked('paddle nine two fifty', ctx);
    expect(r.spans?.some((s) => s.kind === 'paddle')).toBe(true);
    expect(r.spans?.some((s) => s.kind === 'amount')).toBe(true);
  });
});
