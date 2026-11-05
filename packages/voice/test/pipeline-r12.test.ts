import { describe, expect, it } from 'vitest';
import { merge } from '../src/decide/merge.js';
import { validate } from '../src/decide/validate.js';
import { parseBid } from '../src/index.js';
import { toPlaceBid } from '../src/pipeline/bid-command.js';
import { VoicePipeline, type PipelineOutput } from '../src/pipeline/pipeline.js';
import type { SttEvent } from '../src/stt/provider.js';
import type { BidContext, Decision } from '../src/types.js';

const B7 = 'bidder-7';

function context(price = 25000): BidContext {
  return {
    nowMs: 0,
    lotState: 'OPEN',
    currentPriceCents: price,
    minIncrementCents: 1000,
    highBidderId: null,
    roster: new Map([['7', { bidderId: B7, ceilingCents: 10_000_000, holdActive: true }]]),
    recent: [],
  };
}

function final(text: string, confidence: number): SttEvent {
  return { type: 'final', text, words: [], startMs: 0, endMs: 1000, confidence, speechFinal: true };
}

function run(text: string, confidence: number, price = 25000): Decision[] {
  let n = 0;
  const pipeline = new VoicePipeline({
    roomId: 'room1',
    lotId: 'lot1',
    clock: () => 1500,
    ids: () => `seg-${++n}`,
    context: () => context(price),
  });
  const out: PipelineOutput[] = pipeline.push(final(text, confidence));
  return out.flatMap((o) => (o.type === 'decision' ? [o.decision] : []));
}

describe('R12-V08 cents after "and" are never dropped', () => {
  for (const [text, cents] of [
    ['paddle seven three hundred dollars and fifty cents', 30050],
    ['paddle seven five hundred bucks and twenty five cents', 50025],
  ] as const) {
    it(text, () => {
      const r = parseBid(text);
      expect(r.status).toBe('confirm');
      expect(r.reason).toBe('fractional_amount');
      expect(r.amountCents).toBe(cents);
      const [d] = run(text, 0.95);
      expect(d?.kind).toBe('confirm');
    });
  }
});

describe('R12-V01 speech-to-text confidence reaches the pipeline decision', () => {
  it('a clean bid with a low segment confidence is not accepted', () => {
    const [d] = run('paddle seven five hundred', 0.22);
    expect(d?.kind).not.toBe('accept');
  });

  it('a clean bid with a good segment confidence is still accepted', () => {
    const [d] = run('paddle seven five hundred', 0.95);
    expect(d?.kind).toBe('accept');
    expect(d !== undefined && d.evidence.confidence < 1).toBe(true);
  });
});

describe('R12-V03 merge keeps every confirm candidate', () => {
  it('two amounts: both reach the prompt, and a low one below the price does not hide the other', () => {
    const rules = parseBid('paddle seven three hundred or four hundred', {
      speakerBidderId: '7',
    });
    expect(rules.reason).toBe('multiple_amounts');
    const merged = merge(rules, null);
    expect(merged.amountCents).toBeNull();
    const ok = validate(merged, context(25000));
    expect(ok.kind === 'confirm' && ok.candidates).toEqual([30000, 40000]);
    const high = validate(merged, context(35000));
    expect(high.kind).toBe('confirm');
    expect(high.kind === 'confirm' && high.candidates).toEqual([40000]);
  });
});

describe('R12-V04 prompt expiry uses the pipeline clock', () => {
  it('an epoch at with a stream-relative prompt still places the confirmed bid', () => {
    const [d] = run('paddle seven three hundred or four hundred', 0.95);
    expect(d?.kind).toBe('confirm');
    if (d?.kind !== 'confirm') return;
    const option = d.prompt.options[0];
    expect(option).toBeDefined();
    const cmd = toPlaceBid(d, {
      auctionId: '01JC0000000000000000000009',
      lotId: 'lot1',
      at: 1_700_000_000_000,
      promptNowMs: 2000,
      confirmedOptionId: option?.id ?? '',
      current: { ...context(), nowMs: 2000 },
    });
    expect(cmd).not.toBeNull();
    const late = toPlaceBid(d, {
      auctionId: '01JC0000000000000000000009',
      lotId: 'lot1',
      at: 1_700_000_000_000,
      promptNowMs: d.prompt.expiresAtMs,
      confirmedOptionId: option?.id ?? '',
      current: { ...context(), nowMs: 2000 },
    });
    expect(late).toBeNull();
  });
});

describe('R12-V02 auctioneer patter is not a bid', () => {
  for (const text of [
    "lot number twelve who'll give me five hundred",
    'paddle twelve do i hear five hundred and fifty',
  ]) {
    it(text, () => {
      const ds = run(text, 0.95, 40000);
      expect(ds.every((d) => d.kind !== 'accept')).toBe(true);
    });
  }
});
