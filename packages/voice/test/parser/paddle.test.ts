import { describe, expect, it } from 'vitest';
import { tokenize } from '../../src/parser/normalize.js';
import { parseBid } from '../../src/parser/parse.js';
import { extractPaddles } from '../../src/parser/paddle.js';

const paddlesOf = (text: string): string[] => extractPaddles(tokenize(text)).paddles;

describe('T-VOX-040 paddle references (R-VOX-040)', () => {
  const rows: Array<[string, string[]]> = [
    ['paddle twelve', ['12']],
    ['bidder number nine', ['9']],
    ['number twenty one', ['21']],
    ['paddy 7', ['7']],
    ['seat 3 plays 600', ['3']],
    ['padel ate two fifty', ['8']],
    ['card fourteen', ['14']],
    ['paddle 12 for 1,250', ['12']],
    ['paddle five two fifty paddle nine two sixty', ['5', '9']],
    ['nice vase', []],
    ['paddle', []],
    ['paddle hundred', []],
  ];
  for (const [text, expected] of rows) {
    it(`"${text}" -> ${JSON.stringify(expected)}`, () => {
      expect(paddlesOf(text)).toEqual(expected);
    });
  }

  it('tracks the consumed tokens', () => {
    const scan = extractPaddles(['two', 'fifty', 'from', 'bidder', 'number', 'twenty', 'one']);
    expect([...scan.consumed].sort()).toEqual([3, 4, 5, 6]);
  });

  it('twenty one hundred is an amount, not paddle 21', () => {
    expect(paddlesOf('paddle twenty one hundred')).toEqual(['20']);
  });

  it('works on plain string tokens too', () => {
    expect(extractPaddles(['paddle', 'seven']).paddles).toEqual(['7']);
  });

  it('parses the bid for a paddle', () => {
    const r = parseBid('bidder number nine four hundred');
    expect(r.status).toBe('bid');
    expect(r.bidder).toEqual({ kind: 'paddle', value: '9' });
    expect(r.amountCents).toBe(40000);
  });

  it('paddle bids need no speaker and ignore the paddle number as an amount', () => {
    expect(parseBid('paddle 7 three hundred').amountCents).toBe(30000);
    expect(parseBid('number twenty one, five hundred').bidder).toEqual({
      kind: 'paddle',
      value: '21',
    });
    expect(parseBid('paddle 12 for 1,250').amountCents).toBe(125000);
    expect(parseBid('padel ate two fifty').bidder).toEqual({ kind: 'paddle', value: '8' });
  });

  it('a paddle with no amount is none', () => {
    expect(parseBid('paddy 7').reason).toBe('no_amount');
  });
});

describe('T-VOX-041 speaker versus paddle (R-VOX-041)', () => {
  it('a different paddle and speaker is a confirm with both candidates', () => {
    const r = parseBid('paddle 5 three hundred', { speakerBidderId: 'B' });
    expect(r.status).toBe('confirm');
    expect(r.reason).toBe('multiple_bidders');
    expect(r.candidates.map((c) => c.bidder)).toEqual([
      { kind: 'speaker', value: 'B' },
      { kind: 'paddle', value: '5' },
    ]);
    expect(r.candidates.every((c) => c.amountCents === 30000)).toBe(true);
  });

  it('a device-mic speaker naming their own paddle is a bid, not multiple_bidders', () => {
    const own = { speakerBidderId: '01JB0000000000000000000012', speakerPaddle: '12' };
    const r = parseBid('paddle twelve five hundred', own);
    expect(r.status).toBe('bid');
    expect(r.reason).toBe('ok');
  });

  it('a speaker naming another bidder paddle still confirms', () => {
    const other = { speakerBidderId: '01JB0000000000000000000012', speakerPaddle: '12' };
    expect(parseBid('paddle five three hundred', other).reason).toBe('multiple_bidders');
  });

  it('the same paddle and speaker is a bid', () => {
    expect(parseBid('paddle 5 three hundred', { speakerBidderId: '5' }).status).toBe('bid');
  });
});

describe('two paddles', () => {
  it('stay one segment and are flagged multiple_bidders (R-VOX-030)', () => {
    const r = parseBid('paddle five two fifty paddle nine two sixty');
    expect(r.status).toBe('confirm');
    expect(r.reason).toBe('multiple_bidders');
    expect(r.candidates.map((c) => c.bidder)).toEqual([
      { kind: 'paddle', value: '5' },
      { kind: 'paddle', value: '9' },
    ]);
  });

  it('the same paddle twice is one bidder', () => {
    expect(parseBid('paddle 5 paddle 5 three hundred').status).toBe('bid');
  });
});

describe('T-VOX-057 digit read-outs (R-VOX-037)', () => {
  it('"paddle one two three hundred" asks whether the paddle is 1 or 12', () => {
    const r = parseBid('paddle one two three hundred');
    expect(r.status).toBe('confirm');
    expect(r.reason).toBe('multiple_bidders');
    expect(r.candidates.map((c) => c.bidder)).toEqual([
      { kind: 'paddle', value: '1' },
      { kind: 'paddle', value: '12' },
    ]);
    expect(r.candidates[1]?.amountCents).toBe(30000);
  });

  it('a comma stops the read-out: "paddle five, two fifty" is paddle 5', () => {
    const r = parseBid('paddle five, two fifty');
    expect(r.status).toBe('bid');
    expect(r.bidder).toEqual({ kind: 'paddle', value: '5' });
    expect(r.amountCents).toBe(25000);
  });

  it('a read-out that still leaves a readable amount is the plain reading', () => {
    expect(parseBid('bidder number nine four hundred').bidder).toEqual({
      kind: 'paddle',
      value: '9',
    });
  });
});
