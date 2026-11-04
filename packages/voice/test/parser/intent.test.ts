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
    'around three hundred',
    'somewhere between two and three hundred',
    'two hundred, or two fifty, not sure',
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
    'who has two fifty',
    'how much is it now',
    'we are at two fifty now',
    'I have two kids',
  ]) {
    it(`"${text}" -> none`, () => {
      expect(detectIntent(text).status).toBe('none');
    });
  }

  it('"my wife says no" has no amount, so the parser says none', () => {
    expect(parseBid('my wife says no').status).toBe('none');
  });

  it('T-VOX-059: reserve and starting are none even with a speaker', () => {
    for (const text of ['reserve is one hundred', 'starting at fifty']) {
      expect(detectIntent(text).status).toBe('none');
    }
  });
});
