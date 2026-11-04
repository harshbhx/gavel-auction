import { describe, expect, it } from 'vitest';
import { detectIntent } from '../../src/parser/intent.js';
import { parseWithAsr, repairTokens } from '../../src/parser/asr.js';
import { parseBid } from '../../src/parser/parse.js';
import { parseUtterance } from '../../src/parser/utterance.js';

const ctx = { speakerBidderId: '7' };

describe('red-team: ASR repair after a finished amount (R-VOX-042)', () => {
  it('does not turn a trailing for/to into a digit', () => {
    expect(repairTokens(['five', 'hundred', 'for', 'paddle', 'seven']).tokens).toEqual([
      'five',
      'hundred',
      'for',
      'paddle',
      'seven',
    ]);
    const r = parseWithAsr('five hundred for paddle seven', ctx);
    expect(r.amountCents).toBe(50000);
    expect(r.bidder).toEqual({ kind: 'paddle', value: '7' });
    expect(r.flags).not.toContain('asr_repair');
  });

  it('keeps "three hundred to paddle five" and "three hundred to me" at 300', () => {
    expect(parseWithAsr('three hundred to paddle five', ctx).amountCents).toBe(30000);
    expect(parseWithAsr('three hundred to me', ctx).amountCents).toBe(30000);
  });

  it('still repairs "to" in front of a number', () => {
    expect(parseWithAsr('to fifty', ctx).amountCents).toBe(25000);
  });
});

describe('red-team: negation scope (R-VOX-045)', () => {
  for (const text of [
    "I don't want to bid three hundred",
    "I'm not going to bid three hundred",
    "I didn't bid three hundred",
    'no, three hundred is too much',
    'three hundred, no',
    'three hundred not really',
  ]) {
    it(`"${text}" is not a bid`, () => {
      expect(detectIntent(text).status).toBe('none');
      expect(parseUtterance(text, ctx).status).toBe('none');
    });
  }

  it('a plain bid is still a bid', () => {
    expect(parseUtterance('three hundred', ctx).status).toBe('bid');
  });
});

describe('red-team: paddle followed by a scale word (R-VOX-040, 049)', () => {
  for (const text of ['paddle five hundred', 'bid number twelve hundred', 'card two thousand']) {
    it(`"${text}" asks instead of bidding`, () => {
      const r = parseBid(text, ctx);
      expect(r.status).toBe('confirm');
      expect(r.candidates.length).toBe(2);
    });
  }

  it('lists both readings of "paddle five hundred"', () => {
    const r = parseBid('paddle five hundred', ctx);
    expect(r.candidates).toEqual([
      { bidder: { kind: 'paddle', value: '5' }, amountCents: 10000 },
      { bidder: { kind: 'speaker', value: '7' }, amountCents: 50000 },
    ]);
  });

  it('keeps "paddle five three hundred" a plain bid', () => {
    const r = parseBid('paddle five three hundred', { speakerBidderId: '5' });
    expect(r.status).toBe('bid');
    expect(r.amountCents).toBe(30000);
  });
});

describe('red-team: one entry point for all stages (R-VOX-043, 045, 046, 047, 051)', () => {
  it('applies negation, hedge, question, correction and plausibility checks', () => {
    expect(parseUtterance('not three hundred', ctx).status).toBe('none');
    expect(parseUtterance('maybe three hundred', ctx)).toMatchObject({
      status: 'confirm',
      reason: 'hedged',
    });
    expect(parseUtterance('is it three hundred?', ctx).status).toBe('none');
    expect(parseUtterance('scratch that three hundred', ctx).status).toBe('confirm');
    expect(parseUtterance('nine hundred ninety nine thousand point five k', ctx)).toMatchObject({
      status: 'confirm',
      reason: 'implausible_amount',
    });
  });

  it('repairs ASR, then parses and adds spans', () => {
    const r = parseUtterance('to fifty', ctx);
    expect(r.status).toBe('bid');
    expect(r.amountCents).toBe(25000);
    expect(r.spans?.length).toBeGreaterThan(0);
  });

  it('is deterministic', () => {
    expect(parseUtterance('paddle 12 for 1,250', ctx)).toEqual(
      parseUtterance('paddle 12 for 1,250', ctx),
    );
  });
});
