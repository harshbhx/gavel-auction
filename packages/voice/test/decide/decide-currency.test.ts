import { describe, expect, it } from 'vitest';
import { decide, type DecideSegment } from '../../src/decide/decide.js';
import type { BidContext, ParseResult } from '../../src/types.js';

const seg: DecideSegment = {
  segmentId: 's1',
  idempotencyKey: 'k1',
  transcript: 'three fifty rupees',
  audioStartMs: 0,
  audioEndMs: 1000,
  sttProvider: 'test',
  sttConfidence: 0.95,
  replay: false,
};

const ctx: BidContext = {
  nowMs: 5000,
  lotState: 'OPEN',
  currentPriceCents: 10000,
  minIncrementCents: 1000,
  highBidderId: null,
  roster: new Map([['7', { bidderId: 'b-7', ceilingCents: 1000000, holdActive: true }]]),
  recent: [],
};

const currency: ParseResult = {
  status: 'confirm',
  bidder: null,
  amountCents: null,
  reason: 'unsupported_currency',
  candidates: [],
  flags: [],
  confidence: 0.5,
  source: 'rules',
};

describe('currency confirm without an amount (HRD-84)', () => {
  it('keeps the unsupported_currency reason and tells the bidder it was not understood in USD', () => {
    const d = decide(seg, currency, null, ctx);
    expect(d.kind).toBe('confirm');
    if (d.kind !== 'confirm') return;
    expect(d.evidence.reason).toBe('unsupported_currency');
    expect(d.prompt.text).toBe('That amount was not understood in USD. Please say it in dollars.');
    expect(d.prompt.options).toEqual([]);
  });
});
