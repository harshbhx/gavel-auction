import { describe, expect, it } from 'vitest';
import { correctionPrompt, parseCorrection } from '../../src/parser/correction.js';
import type { ParseContext } from '../../src/types.js';

const base: ParseContext = { speakerBidderId: '7' };
const pending = (ageMs: number): ParseContext => ({
  ...base,
  pendingCandidate: {
    id: 'p1',
    bidder: { kind: 'speaker', value: '7' },
    amountCents: 35000,
    ageMs,
  },
});
const amounts = (text: string, ctx: ParseContext = base): Array<number | null> =>
  (parseCorrection(text, ctx)?.result.candidates ?? []).map((c) => c.amountCents);

describe('T-VOX-043 corrections always confirm (R-VOX-043)', () => {
  it('confirms every correction form and never bids', () => {
    for (const text of [
      'two fifty no wait three hundred',
      'no, make it 400',
      'make that 400',
      'not three hundred, two fifty',
    ]) {
      const r = parseCorrection(text, base)?.result;
      expect(r?.status, text).toBe('confirm');
      expect(r?.reason, text).toBe('correction');
      expect(r?.flags, text).toContain('correction');
    }
  });

  it('carries only the final amount', () => {
    expect(amounts('two fifty no wait three hundred')).toEqual([30000]);
    expect(amounts('no, make it 400')).toEqual([40000]);
    expect(amounts('make that 400')).toEqual([40000]);
    expect(amounts('not three hundred, two fifty')).toEqual([25000]);
    expect(amounts('three hundred sorry I mean two hundred')).toEqual([20000]);
  });

  it('names the replaced amount when a pending candidate exists', () => {
    const o = parseCorrection('make that 400', pending(3000));
    expect(o).not.toBeNull();
    if (o === null) return;
    expect(correctionPrompt(o)).toContain('$350');
    expect(correctionPrompt(o)).toContain('$400');
  });

  it('names the replaced amount of "not X, Y"', () => {
    const o = parseCorrection('not three hundred, two fifty', base);
    expect(o && correctionPrompt(o)).toBe('Replace $300 with $250?');
  });

  it('returns null for an ordinary bid', () => {
    expect(parseCorrection('three hundred', base)).toBeNull();
    expect(parseCorrection('', base)).toBeNull();
  });
});

describe('T-VOX-044 retraction (R-VOX-044)', () => {
  it('"scratch that" is none/retract and cancels a fresh pending candidate', () => {
    const o = parseCorrection('scratch that', pending(3000));
    expect(o?.result.status).toBe('none');
    expect(o?.result.reason).toBe('retract');
    expect(o?.cancelPending).toBe(true);
  });

  it('does not cancel a stale pending candidate or when none exists', () => {
    expect(parseCorrection('scratch that', pending(9000))?.cancelPending).toBe(false);
    expect(parseCorrection('never mind', base)?.cancelPending).toBe(false);
    expect(parseCorrection('never mind', base)?.result.reason).toBe('retract');
  });

  it('does not cancel a pending candidate of another bidder', () => {
    const ctx: ParseContext = {
      speakerBidderId: '9',
      pendingCandidate: pending(1000).pendingCandidate,
    };
    expect(parseCorrection('scratch that', ctx)?.cancelPending).toBe(false);
  });

  it('"actually never mind" is a retraction', () => {
    expect(parseCorrection('actually never mind', pending(100))?.result.reason).toBe('retract');
  });
});

describe('T-VOX-050 make it (R-VOX-050)', () => {
  it('is a bid with a 0.05 penalty and the make_it flag when nothing is pending', () => {
    const r = parseCorrection('make it four hundred', base)?.result;
    expect(r?.status).toBe('bid');
    expect(r?.amountCents).toBe(40000);
    expect(r?.flags).toContain('make_it');
    expect(r?.confidence).toBeCloseTo(0.95, 5);
    expect(parseCorrection("let's make it four fifty", base)?.result.amountCents).toBe(45000);
  });

  it('is a correction when a candidate is pending', () => {
    const r = parseCorrection('make it four hundred', pending(2000))?.result;
    expect(r?.status).toBe('confirm');
    expect(r?.reason).toBe('correction');
    expect(r?.candidates.map((c) => c.amountCents)).toEqual([40000]);
  });
});
