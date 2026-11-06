import { describe, expect, it } from 'vitest';
import { detectIntent } from '../../src/parser/intent.js';
import { parseBid } from '../../src/parser/parse.js';

describe('T-VOX-045 negations (R-VOX-045)', () => {
  for (const text of [
    "don't bid three hundred",
    "I won't go to 400",
    'no thanks',
    "I'm out",
    'pass',
  ]) {
    it(`"${text}" -> none`, () => {
      const i = detectIntent(text);
      expect(i.status).toBe('none');
      expect(['negation', 'withdraw']).toContain(i.reason);
    });
  }

  it('"not three hundred, two fifty" -> confirm', () => {
    const i = detectIntent('not three hundred, two fifty');
    expect(i.status).toBe('confirm');
    expect(i.reason).toBe('negation');
  });

  it('a negation far from the amount in a long clause does not apply', () => {
    expect(
      detectIntent("I don't know what the others think about the lot but three hundred").kind,
    ).not.toBe('negation');
    expect(detectIntent('three hundred').kind).toBe('bid_like');
  });
});

describe('T-VOX-046 hedges (R-VOX-046)', () => {
  for (const text of [
    'maybe two fifty',
    'around four hundred',
    'somewhere between two and three hundred',
    'three hundred, or three fifty, not sure',
  ]) {
    it(`"${text}" -> confirm hedged`, () => {
      const i = detectIntent(text);
      expect(i.status).toBe('confirm');
      expect(i.reason).toBe('hedged');
    });
  }
});

describe('T-VOX-047 questions and background talk (R-VOX-047)', () => {
  for (const text of [
    'is it two fifty?',
    'who has three fifty',
    'how much is it now',
    'we are at two fifty now',
    'I have three kids',
  ]) {
    it(`"${text}" -> none`, () => {
      expect(detectIntent(text).status).toBe('none');
    });
  }

  it('"my wife says no" has no amount, so the parser says none', () => {
    expect(parseBid('my wife says no').status).toBe('none');
  });

  it('T-VOX-059: reserve and starting are none even with a speaker', () => {
    for (const text of ['reserve is one hundred', 'starting at sixty']) {
      expect(detectIntent(text).status).toBe('none');
    }
  });
});

describe('HRD-41 auctioneer patter is never a bid', () => {
  for (const text of [
    "lot number twelve who'll give me five hundred",
    'item number twelve looking for five hundred',
    'paddle twelve do I hear five hundred and fifty',
    'I have paddle twelve with you at five hundred',
  ]) {
    it(`"${text}" -> none`, () => {
      expect(detectIntent(text).status).toBe('none');
    });
  }

  it('"lot number twelve five hundred" names no paddle', () => {
    expect(parseBid('lot number twelve five hundred').bidder).toBeNull();
  });
});

describe('HRD-45 bid phrasings with the word number are still bids', () => {
  it('"paddle number 12 fifty" -> bid on paddle 12', () => {
    expect(detectIntent('paddle number 12 fifty').kind).toBe('bid_like');
    const r = parseBid('paddle number 12 fifty');
    expect(r.status).toBe('bid');
    expect(r.bidder).toEqual({ kind: 'paddle', value: '12' });
    expect(r.amountCents).toBe(5000);
  });

  it('"number twelve bids fifty" -> bid on paddle 12', () => {
    expect(detectIntent('number twelve bids fifty').kind).toBe('bid_like');
    const r = parseBid('number twelve bids fifty');
    expect(r.status).toBe('bid');
    expect(r.bidder).toEqual({ kind: 'paddle', value: '12' });
    expect(r.amountCents).toBe(5000);
  });
});
