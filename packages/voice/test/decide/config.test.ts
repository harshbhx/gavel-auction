import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/decide/config.js';
import { DEFAULT_POLICY, classify } from '../../src/decide/policy.js';
import type { ParseResult } from '../../src/types.js';

const parse = (confidence: number): ParseResult => ({
  status: 'bid',
  bidder: { kind: 'paddle', value: '12' },
  amountCents: 35_000,
  reason: 'ok',
  candidates: [],
  flags: [],
  confidence,
  source: 'merged',
});

describe('defaultConfig (R-VOX-063)', () => {
  it('is AUTO 0.85 and CONFIRM 0.50 and matches the policy default', () => {
    expect(defaultConfig).toEqual({ auto: 0.85, confirm: 0.5 });
    expect(defaultConfig).toEqual(DEFAULT_POLICY);
  });

  it('T-VOX-071: boundaries with the default config', () => {
    expect(classify(parse(0.85), defaultConfig)).toBe('accept');
    expect(classify(parse(0.8499), defaultConfig)).toBe('confirm');
    expect(classify(parse(0.5), defaultConfig)).toBe('confirm');
    expect(classify(parse(0.4999), defaultConfig)).toBe('drop');
  });
});
