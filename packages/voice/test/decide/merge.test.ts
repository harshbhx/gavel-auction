import { describe, expect, it } from 'vitest';
import { merge } from '../../src/decide/merge.js';
import type { ParseResult } from '../../src/types.js';

const P12 = { kind: 'paddle', value: '12' } as const;
const P7 = { kind: 'paddle', value: '7' } as const;

function parse(over: Partial<ParseResult>): ParseResult {
  return {
    status: 'bid',
    bidder: P12,
    amountCents: 35000,
    reason: 'ok',
    candidates: [],
    flags: [],
    confidence: 0.9,
    source: 'rules',
    ...over,
  };
}
const none = (over: Partial<ParseResult> = {}) =>
  parse({ status: 'none', bidder: null, amountCents: null, reason: 'no_amount', ...over });

describe('merge table', () => {
  it('row 1: agree bids with bonus', () => {
    const r = merge(parse({ confidence: 0.9 }), parse({ source: 'llm' }));
    expect(r.status).toBe('bid');
    expect(r.confidence).toBe(0.92);
    expect(r.candidates).toEqual([]);
  });

  it('row 2: differing bid confirms with both candidates', () => {
    const r = merge(parse({}), parse({ amountCents: 40000, source: 'llm' }));
    expect(r.status).toBe('confirm');
    expect(r.reason).toBe('llm_disagree');
    expect(r.candidates.map((c) => c.amountCents)).toEqual([35000, 40000]);
  });

  it('row 3: model none confirms with rules candidate', () => {
    const r = merge(parse({}), none());
    expect(r.status).toBe('confirm');
    expect(r.candidates).toEqual([{ bidder: P12, amountCents: 35000 }]);
  });

  it('row 4: model unavailable uses the 0.90 rule', () => {
    expect(merge(parse({ confidence: 0.9 }), null).status).toBe('bid');
    expect(merge(parse({ confidence: 0.89 }), null).status).toBe('confirm');
    expect(merge(parse({ confidence: 0.78, flags: ['colloquial_hundreds'] }), null).status).toBe(
      'confirm',
    );
    expect(merge(parse({ confidence: 0.95, flags: ['make_it'] }), null).status).toBe('confirm');
  });

  it('row 5: rules confirm wins and unions candidates, max 3', () => {
    const rules = parse({
      status: 'confirm',
      reason: 'multiple_amounts',
      candidates: [
        { bidder: P12, amountCents: 30000 },
        { bidder: P12, amountCents: 35000 },
      ],
    });
    const llm = parse({
      candidates: [
        { bidder: P7, amountCents: 35000 },
        { bidder: P12, amountCents: 50000 },
      ],
    });
    const r = merge(rules, llm);
    expect(r.status).toBe('confirm');
    expect(r.reason).toBe('multiple_amounts');
    expect(r.candidates).toHaveLength(3);
  });

  it('row 6: rules none, model bid at 0.80 confirms llm_disagree', () => {
    const r = merge(none(), parse({ confidence: 0.8, source: 'llm' }));
    expect(r.status).toBe('confirm');
    expect(r.reason).toBe('llm_disagree');
    expect(r.candidates).toHaveLength(1);
  });

  it('row 7: otherwise none', () => {
    expect(merge(none(), parse({ confidence: 0.79 })).status).toBe('none');
    expect(merge(none(), null).status).toBe('none');
    expect(merge(none(), none()).status).toBe('none');
  });

  it('model-only values never become an accepted bid', () => {
    const r = merge(parse({}), parse({ bidder: P7, amountCents: 99900, source: 'llm' }));
    expect(r.status).toBe('confirm');
    expect(r.reason).toBe('llm_disagree');
    const r2 = merge(none(), parse({ bidder: P7, amountCents: 99900, confidence: 0.99 }));
    expect(r2.status).toBe('confirm');
  });
});
