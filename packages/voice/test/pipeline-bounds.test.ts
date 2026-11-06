import { describe, expect, it } from 'vitest';
import { parseBid } from '../src/parser/parse.js';
import { RETRACT_ADVISORY_MS, VoicePipeline } from '../src/pipeline/pipeline.js';
import type { SttEvent } from '../src/stt/provider.js';
import type { BidContext } from '../src/types.js';

function context(nowMs: number): BidContext {
  return {
    nowMs,
    lotState: 'OPEN',
    currentPriceCents: 25000,
    minIncrementCents: 1000,
    highBidderId: null,
    roster: new Map([['7', { bidderId: 'bidder-7', ceilingCents: 10_000_000, holdActive: true }]]),
    recent: [],
  };
}

function final(text: string): SttEvent {
  return {
    type: 'final',
    text,
    words: [],
    startMs: 0,
    endMs: 1000,
    confidence: 0.95,
    speechFinal: true,
  };
}

describe('HRD-57 accepted bids are pruned', () => {
  it('keeps only bids inside the retraction window however many were accepted', () => {
    let now = 1500;
    let n = 0;
    const pipeline = new VoicePipeline({
      roomId: 'room1',
      lotId: 'lot1',
      clock: () => now,
      ids: () => `seg-${++n}`,
      context: () => context(now),
      llm: (t: string) => parseBid(t),
    });
    for (let i = 0; i < 50; i++) {
      pipeline.push(final('paddle seven five hundred'));
      now += RETRACT_ADVISORY_MS;
    }
    const kept = (pipeline as unknown as { accepted: unknown[] }).accepted;
    expect(kept.length).toBeLessThanOrEqual(1);
  });
});
