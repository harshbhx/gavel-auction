import { describe, expect, it } from 'vitest';
import { buildAudit } from '../../src/decide/audit.js';
import { decide, type DecideSegment } from '../../src/decide/decide.js';
import { rejectPrompt } from '../../src/pipeline/reject.js';
import type { BidContext, ParseResult } from '../../src/types.js';

function ctxFor(): BidContext {
  return {
    nowMs: 10_000,
    lotState: 'OPEN',
    currentPriceCents: 10_000,
    minIncrementCents: 500,
    highBidderId: null,
    roster: new Map([
      ['12', { bidderId: 'b12', ceilingCents: 1_000_000, holdActive: true }],
      ['7', { bidderId: 'b7', ceilingCents: 1_000_000, holdActive: true }],
    ]),
    recent: [],
  };
}

function segFor(text: string): DecideSegment {
  return {
    segmentId: 's1',
    idempotencyKey: `room:lot:0:${text.length}`,
    transcript: text,
    audioStartMs: 0,
    audioEndMs: 1500,
    sttProvider: 'fake',
    sttConfidence: 0.95,
    replay: false,
  };
}

const twoBidders: ParseResult = {
  status: 'confirm',
  bidder: null,
  amountCents: null,
  reason: 'multiple_bidders',
  candidates: [
    { bidder: { kind: 'paddle', value: '12' }, amountCents: 15_000 },
    { bidder: { kind: 'paddle', value: '7' }, amountCents: 16_000 },
  ],
  flags: [],
  confidence: 0.6,
  source: 'rules',
};

const twoAmounts: ParseResult = {
  status: 'confirm',
  bidder: { kind: 'paddle', value: '12' },
  amountCents: null,
  reason: 'multiple_amounts',
  candidates: [
    { bidder: { kind: 'paddle', value: '12' }, amountCents: 15_000 },
    { bidder: { kind: 'paddle', value: '12' }, amountCents: 16_000 },
  ],
  flags: [],
  confidence: 0.6,
  source: 'rules',
};

describe('crosstalk', () => {
  it('T-VOX-100: two paddles in one segment end in confirm, never accept', () => {
    const d = decide(segFor('twelve one fifty seven one sixty'), twoBidders, twoBidders, ctxFor());
    expect(d.kind).toBe('confirm');
    if (d.kind !== 'confirm') return;
    expect(d.prompt.options.map((o) => o.bidderId)).toEqual(['b12', 'b7']);
    expect(d.prompt.defaultAction).toBe('drop');
  });

  it('T-VOX-100: two amounts for one paddle end in confirm', () => {
    const d = decide(segFor('twelve one fifty one sixty'), twoAmounts, twoAmounts, ctxFor());
    expect(d.kind).toBe('confirm');
    if (d.kind !== 'confirm') return;
    expect(d.prompt.options.map((o) => o.amountCents)).toEqual([15_000, 16_000]);
  });

  it('T-VOX-100: console reject drops with an audit record that reads rejected', () => {
    const ctx = ctxFor();
    const d = decide(segFor('crosstalk'), twoBidders, twoBidders, ctx);
    const dropped = rejectPrompt(d, ctx, 'auctioneer');
    expect(dropped?.kind).toBe('drop');
    if (dropped === null) return;
    const rec = buildAudit(dropped);
    expect(rec.outcome).toBe('rejected');
    expect(rec.decision).toBe('drop');
    expect(rec.confirmed).toBe(false);
    expect(rec.reason).toBe(d.evidence.reason);
  });

  it('only a confirm can be rejected', () => {
    const ctx = ctxFor();
    const none: ParseResult = {
      ...twoBidders,
      status: 'none',
      reason: 'no_amount',
      candidates: [],
    };
    const drop = decide(segFor('hm'), none, none, ctx);
    expect(rejectPrompt(drop, ctx, 'auctioneer')).toBeNull();
  });
});
