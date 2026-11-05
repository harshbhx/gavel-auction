import { describe, expect, it } from 'vitest';
import { cardEnabled, gatesResult, parseGatesResult } from '../src/gatesResult.js';

describe('gatesResult (T-PAY-025)', () => {
  it('ships with the G1 decision and G4 verified, card authorize off', () => {
    expect(gatesResult).toEqual({
      g1_remainder_mode: 'A',
      g2_card_authorize: false,
      g4_webhooks_verified: true,
    });
    expect(cardEnabled()).toBe(false);
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
