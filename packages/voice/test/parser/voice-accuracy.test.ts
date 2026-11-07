import { describe, expect, it } from 'vitest';
import { parseUtterance } from '../../src/parser/utterance.js';

/**
 * Cases taken from what Deepgram and Groq returned for the synthetic G5 clips (see docs/GATES.md,
 * "G5 error analysis"). The rules are general: none of them looks at a clip id or a clip text.
 */

const amounts = (text: string, ctx = {}): Array<number | null> =>
  parseUtterance(text, ctx).candidates.map((c) => c.amountCents);

describe('paddle word written as a homophone', () => {
  for (const word of ['panel', 'pedal', 'peddle']) {
    it(`"${word} twelve three fifty" is paddle 12 at 350`, () => {
      const r = parseUtterance(`${word} twelve three fifty`, {});
      expect(r.status).toBe('bid');
      expect(r.bidder).toEqual({ kind: 'paddle', value: '12' });
      expect(r.amountCents).toBe(35000);
      expect(r.flags).toContain('asr_repair');
    });
  }

  it('is left alone when no number follows', () => {
    expect(parseUtterance('the panel is nice', {}).status).toBe('none');
  });
});

describe('paddle and amount written as one digit run', () => {
  it('"Bidder number 9400." asks, with paddle 9 and 400 dollars as the reading', () => {
    const r = parseUtterance('Bidder number 9400.', {});
    expect(r.status).toBe('confirm');
    expect(r.candidates).toEqual([{ bidder: { kind: 'paddle', value: '9' }, amountCents: 40000 }]);
  });

  it('"Panel 12,350" offers both splits and never accepts', () => {
    const r = parseUtterance('Panel 12,350', {});
    expect(r.status).toBe('confirm');
    expect(r.candidates).toContainEqual({
      bidder: { kind: 'paddle', value: '12' },
      amountCents: 35000,
    });
    expect(r.candidates).toContainEqual({
      bidder: { kind: 'paddle', value: '1' },
      amountCents: 235000,
    });
  });

  it('a lot number is not a paddle', () => {
    expect(parseUtterance('lot number 1500', {}).status).not.toBe('bid');
  });
});

describe('dollars-and-cents written for a spoken colloquial amount', () => {
  const ctx = { speakerBidderId: '6', currentPriceCents: 22500 };

  it('"$2.50" asks and offers 250 dollars next to 2.50', () => {
    const r = parseUtterance('$2.50', ctx);
    expect(r.status).toBe('confirm');
    expect(amounts('$2.50', ctx)).toEqual([250, 25000]);
  });

  it('"$2.50?" with a rising tone is asked, not dropped', () => {
    const r = parseUtterance('$2.50?', ctx);
    expect(r.status).toBe('confirm');
    expect(amounts('$2.50?', ctx)).toEqual([250, 25000]);
  });

  it('a trailing full stop does not hide the reading', () => {
    expect(amounts('Maybe $2.50.', ctx)).toEqual([250, 25000]);
  });

  it('"12.50" offers 1250 dollars', () => {
    expect(amounts('12.50', { speakerBidderId: '6', currentPriceCents: 122500 })).toEqual([
      1250, 125000,
    ]);
  });
});

describe('teens and tens written as digits', () => {
  it('"15" at a price of 40 dollars could be 50 and asks', () => {
    const r = parseUtterance('15', { speakerBidderId: '4', currentPriceCents: 4000 });
    expect(r.status).toBe('confirm');
    expect(r.reason).toBe('homophone');
    expect(r.candidates.map((c) => c.amountCents)).toEqual([1500, 5000]);
  });

  it('"50" above the price stays a bid', () => {
    const r = parseUtterance('50', { speakerBidderId: '4', currentPriceCents: 1000 });
    expect(r.status).toBe('bid');
    expect(r.amountCents).toBe(5000);
  });
});

describe('statements and questions', () => {
  const ctx = { speakerBidderId: '7', currentPriceCents: 20000 };

  it('"it is two fifty" is a stated price: asked, never booked', () => {
    const r = parseUtterance('it is two fifty', ctx);
    expect(r.status).toBe('confirm');
    expect(r.reason).toBe('auctioneer_talk');
  });

  it('"is it two fifty" and "Is it $2.50?" are questions', () => {
    expect(parseUtterance('is it two fifty', ctx).status).toBe('none');
    expect(parseUtterance('Is it $2.50?', ctx).status).toBe('none');
  });

  it('a question mark after words that are not a bid still drops', () => {
    expect(parseUtterance('what about the three vases?', ctx).status).toBe('none');
  });
});

describe('number grammar of the spoken amounts in the clips', () => {
  const ctx = { speakerBidderId: '4', currentPriceCents: 1000 };
  const rows: Array<[string, number]> = [
    ['one fifty', 15000],
    ['one hundred fifty', 15000],
    ['a hundred and fifty', 15000],
    ['two fifty five', 25500],
    ['fifteen hundred', 150000],
    ['five hundred bucks', 50000],
    ['I bid seventy five', 7500],
  ];
  for (const [text, cents] of rows) {
    it(`"${text}" is ${cents} cents`, () => {
      const r = parseUtterance(text, ctx);
      expect(r.status).toBe('bid');
      expect(r.amountCents).toBe(cents);
    });
  }
});

describe('a number that could not be read next to one that could', () => {
  it('"two fifteen o eight three hundred" is asked about, never booked', () => {
    const r = parseUtterance('two fifteen o eight three hundred', {
      speakerBidderId: '7',
      currentPriceCents: 20000,
    });
    expect(r.status).toBe('confirm');
    expect(r.reason).toBe('uninterpretable_number');
  });
});
