import { describe, expect, it } from 'vitest';
import { cardEnabled, gatesResult, parseGatesResult } from '../src/gatesResult.js';

describe('gatesResult (T-PAY-025)', () => {
  it('ships with the G1 decision, G2 card authorize on and G4 verified', () => {
    expect(gatesResult).toEqual({
      g1_remainder_mode: 'A',
      g2_card_authorize: true,
      g4_webhooks_verified: true,
    });
    expect(cardEnabled()).toBe(true);
  });

  it('cardEnabled follows g2_card_authorize', () => {
    const base = parseGatesResult({ ...gatesResult, g2_card_authorize: false });
    expect(cardEnabled(base)).toBe(false);
    expect(cardEnabled({ ...base, g2_card_authorize: true })).toBe(true);
  });

  it('rejects malformed flag files', () => {
    expect(() => parseGatesResult({ g2_card_authorize: 'yes' })).toThrow();
    expect(() => parseGatesResult({ ...gatesResult, extra: 1 })).toThrow();
    expect(() => parseGatesResult({ ...gatesResult, g1_remainder_mode: 'D' })).toThrow();
  });
});
