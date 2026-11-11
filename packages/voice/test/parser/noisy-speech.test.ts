import { describe, expect, it } from 'vitest';
import { parseUtterance } from '../../src/parser/utterance.js';

/**
 * Text a speech provider can return for a loud room. Noise is simulated as text: these cases do not
 * measure accuracy in a real room (see packages/voice/README.md). They check that a damaged
 * transcript never books on its own.
 */

describe('noise fragments never book', () => {
  for (const text of ['um', 'mm hmm', 'the the the', 'uh uh', '...']) {
    it(`"${text}" is not a bid`, () => {
      expect(parseUtterance(text, { speakerBidderId: '4', currentPriceCents: 20000 }).status).toBe(
        'none',
      );
    });
  }
});

describe('a misheard paddle word is repaired or asked, never silently booked wrong', () => {
  const ctx = { currentPriceCents: 20000 };
  for (const word of ['panel', 'pedal', 'peddle']) {
    it(`"${word} twelve three fifty" is flagged as repaired`, () => {
      const r = parseUtterance(`${word} twelve three fifty`, ctx);
      expect(r.status).toBe('bid');
      expect(r.flags).toContain('asr_repair');
    });
  }
});

describe('confirm fallback on a damaged amount', () => {
  const ctx = { speakerBidderId: '7', currentPriceCents: 20000 };

  it('a digit run that fuses paddle and amount asks', () => {
    const r = parseUtterance('Bidder number 9400.', {});
    expect(r.status).toBe('confirm');
    expect(r.candidates.length).toBeGreaterThan(0);
  });

  it('an unreadable number next to a readable one asks', () => {
    const r = parseUtterance('two fifteen o eight three hundred', ctx);
    expect(r.status).toBe('confirm');
    expect(r.reason).toBe('uninterpretable_number');
  });

  it('a stated price is asked about, not booked', () => {
    expect(parseUtterance('it is two fifty', ctx).status).toBe('confirm');
  });

  it('the same text gives the same answer twice', () => {
    expect(parseUtterance('Panel 12,350', {})).toEqual(parseUtterance('Panel 12,350', {}));
  });
});
