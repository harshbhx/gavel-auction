import { describe, expect, it } from 'vitest';
import { HARD_FLAGS, classify } from '../../src/decide/policy.js';
import type { ParseResult } from '../../src/types.js';

function parse(over: Partial<ParseResult>): ParseResult {
  return {
    status: 'bid',
    bidder: { kind: 'paddle', value: '12' },
    amountCents: 35000,
    reason: 'ok',
    candidates: [],
    flags: [],
    confidence: 0.95,
    source: 'merged',
    ...over,
  };
}

describe('classify', () => {
  it('T-VOX-071: boundaries', () => {
    expect(classify(parse({ confidence: 0.85 }))).toBe('accept');
    expect(classify(parse({ confidence: 0.8499 }))).toBe('confirm');
    expect(classify(parse({ confidence: 0.5 }))).toBe('confirm');
    expect(classify(parse({ confidence: 0.4999 }))).toBe('drop');
  });

  it('thresholds are overridable', () => {
    const cfg = { auto: 0.9, confirm: 0.6 };
    expect(classify(parse({ confidence: 0.88 }), cfg)).toBe('confirm');
    expect(classify(parse({ confidence: 0.55 }), cfg)).toBe('drop');
    expect(classify(parse({ confidence: 0.9 }), cfg)).toBe('accept');
  });

  it.each(HARD_FLAGS)('T-VOX-073: %s forces confirm at 0.99', (reason) => {
    expect(classify(parse({ reason, confidence: 0.99 }))).toBe('confirm');
  });

  it('correction flag forces confirm', () => {
    expect(classify(parse({ flags: ['correction'], confidence: 0.99 }))).toBe('confirm');
  });

  it('none drops and confirm status never accepts', () => {
    expect(classify(parse({ status: 'none', confidence: 0.99 }))).toBe('drop');
    expect(classify(parse({ status: 'confirm', confidence: 0.99 }))).toBe('confirm');
  });
});
