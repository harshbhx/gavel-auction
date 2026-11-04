import { describe, expect, it } from 'vitest';
import { parseWithAsr, repairTokens } from '../../src/parser/asr.js';

const ctx = { speakerBidderId: '7' };

describe('T-VOX-042 ASR repair (R-VOX-042)', () => {
  it('"to fifty" is 250', () => {
    const r = parseWithAsr('to fifty', ctx);
    expect(r.status).toBe('bid');
    expect(r.amountCents).toBe(25000);
    expect(r.flags).toContain('asr_repair');
  });

  it('"I\'ll go to hundred and fifty" is confirm to_for_ambiguity with both amounts', () => {
    const r = parseWithAsr("I'll go to hundred and fifty", ctx);
    expect(r.status).toBe('confirm');
    expect(r.reason).toBe('to_for_ambiguity');
    expect(r.candidates.map((c) => c.amountCents)).toEqual([15000, 25000]);
  });

  it('leaves "ate" alone when no number or paddle word is next to it', () => {
    expect(repairTokens(['ate']).tokens).toEqual(['ate']);
    expect(repairTokens(['he', 'ate', 'lunch']).tokens).toEqual(['he', 'ate', 'lunch']);
    expect(repairTokens(['ate', 'hundred']).tokens).toEqual(['eight', 'hundred']);
  });

  it('repairs "for" after a paddle word, matching the Python golden', () => {
    const r = parseWithAsr('paddle for three hundred', ctx);
    expect(r.status).toBe('bid');
    expect(r.bidder).toEqual({ kind: 'paddle', value: '4' });
    expect(r.amountCents).toBe(30000);
  });

  it('repairs always-wrong spellings anywhere and reports no ambiguity', () => {
    const r = repairTokens(['tree', 'hunderd', 'fiddy']);
    expect(r.tokens).toEqual(['three', 'hundred', 'fifty']);
    expect(r.ambiguous).toBe(false);
    expect(r.alt).toBeNull();
  });

  it('keeps the preposition reading as the alternative', () => {
    const r = repairTokens(['raise', 'it', 'to', 'three', 'hundred']);
    expect(r.ambiguous).toBe(true);
    expect(r.alt).toEqual(['raise', 'it', 'three', 'hundred']);
  });
});
