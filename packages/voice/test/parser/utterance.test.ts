import { describe, expect, it } from 'vitest';
import { detectIntent } from '../../src/parser/intent.js';
import { parseWithAsr, repairTokens } from '../../src/parser/asr.js';
import { parseBid } from '../../src/parser/parse.js';
import { parseUtterance, parseUtteranceOutcome } from '../../src/parser/utterance.js';
import { PendingCandidateStore } from '../../src/segment/dedupe.js';

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

describe('red-team round 2: retraction signal (R-VOX-044, 050)', () => {
  it('parseUtteranceOutcome reports cancelPending so the pending store is cleared', () => {
    const store = new PendingCandidateStore();
    store.set({ id: 'c1', bidder: { kind: 'paddle', value: '7' }, amountCents: 35000 }, 1000);
    const pendingCandidate = store.get(4000);
    const out = parseUtteranceOutcome('scratch that', { speakerBidderId: '7', pendingCandidate });
    expect(out.result.status).toBe('none');
    expect(out.result.reason).toBe('retract');
    expect(out.cancelPending).toBe(true);
    if (out.cancelPending) store.clear();
    expect(store.get(4100)).toBeUndefined();
  });

  it('does not cancel for another speaker or an ordinary bid', () => {
    const pendingCandidate = {
      id: 'c1',
      bidder: { kind: 'paddle' as const, value: '7' },
      amountCents: 35000,
      ageMs: 1000,
    };
    expect(
      parseUtteranceOutcome('scratch that', { speakerBidderId: '9', pendingCandidate })
        .cancelPending,
    ).toBe(false);
    expect(parseUtteranceOutcome('four hundred', ctx).cancelPending).toBe(false);
  });
});

describe('red-team round 2: withdrawals and limits are not bids (R-VOX-045, 046)', () => {
  for (const text of [
    'count me out at four hundred',
    "I'm done at three hundred",
    'im done at three hundred',
    'im out at three hundred',
  ]) {
    it(`"${text}" is none`, () => {
      const r = parseUtterance(text, ctx);
      expect(r.status).toBe('none');
      expect(r.amountCents).toBeNull();
    });
  }
  for (const text of [
    "I'll stop at three hundred",
    'my limit is three hundred',
    'my budget is five hundred',
  ]) {
    it(`"${text}" is never an auto-accepted bid`, () => {
      const r = parseUtterance(text, ctx);
      expect(r.status).not.toBe('bid');
      expect(r.amountCents).toBeNull();
    });
  }
});

describe('red-team round 2: "for" after a spoken paddle (R-VOX-042)', () => {
  it('keeps the preposition in "paddle seven for three hundred"', () => {
    expect(repairTokens(['paddle', 'seven', 'for', 'three', 'hundred']).tokens).toEqual([
      'paddle',
      'seven',
      'for',
      'three',
      'hundred',
    ]);
    const r = parseUtterance('paddle seven for three hundred', {});
    expect(r.status).toBe('bid');
    expect(r.bidder).toEqual({ kind: 'paddle', value: '7' });
    expect(r.amountCents).toBe(30000);
  });

  it('reads "paddle twelve for four hundred" as paddle 12 and 400', () => {
    const r = parseUtterance('paddle twelve for four hundred', {});
    expect(r.bidder).toEqual({ kind: 'paddle', value: '12' });
    expect(r.amountCents).toBe(40000);
  });
});
