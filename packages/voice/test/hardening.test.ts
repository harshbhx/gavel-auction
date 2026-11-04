import { describe, expect, it } from 'vitest';
import { refineAmounts } from '../src/parser/ambiguity.js';
import { parseCorrection } from '../src/parser/correction.js';
import { detectIntent } from '../src/parser/intent.js';
import { parseBid } from '../src/parser/parse.js';
import { FLAG_END_OF_STREAM } from '../src/audio/frame.js';
import { FrameAssembler } from '../src/audio/assembler.js';
import { parseLlmOutput } from '../src/llm/schema.js';
import { DuplicateFilter, idempotencyKey } from '../src/segment/dedupe.js';
import { Segmenter } from '../src/segment/segmenter.js';
import { EventChannel } from '../src/stt/provider.js';
import { parseResultSchema } from '../src/types.js';
import type { ParseContext } from '../src/types.js';

const ctx: ParseContext = { speakerBidderId: '7' };

describe('segmenter keep-alives (#793)', () => {
  it('a blank interim does not stop a held final from flushing', () => {
    const s = new Segmenter();
    s.push(
      {
        type: 'final',
        text: 'paddle five three hundred',
        words: [],
        startMs: 0,
        endMs: 1000,
        confidence: 0.9,
        speechFinal: false,
      },
      0,
    );
    s.push({ type: 'interim', text: '', startMs: 1000 }, 500);
    const out = s.tick(1600);
    expect(out.map((e) => e.type)).toEqual(['segment']);
  });
});

describe('retraction by a bystander (#796)', () => {
  const pending: ParseContext['pendingCandidate'] = {
    id: 'p',
    bidder: { kind: 'speaker', value: '7' },
    amountCents: 35000,
    ageMs: 1000,
  };
  it('a room mic with no paddle cannot cancel a pending bid', () => {
    expect(parseCorrection('never mind', { pendingCandidate: pending })?.cancelPending).toBe(false);
  });
  it('a paddle that equals a speaker id is a different bidder kind', () => {
    const o = parseCorrection('scratch that paddle 7', { pendingCandidate: pending });
    expect(o?.cancelPending).toBe(false);
  });
  it('the speaker can still cancel their own pending bid', () => {
    expect(
      parseCorrection('never mind', { ...ctx, pendingCandidate: pending })?.cancelPending,
    ).toBe(true);
  });
});

describe('questions and hedges without punctuation (#797)', () => {
  for (const text of [
    'should I bid three hundred',
    'would you take three hundred',
    'where is paddle five',
  ]) {
    it(`"${text}" is a question`, () => {
      expect(detectIntent(text).status).toBe('none');
    });
  }
  for (const text of ['hold on three fifty', 'probably three hundred']) {
    it(`"${text}" is hedged`, () => {
      expect(detectIntent(text).reason).toBe('hedged');
    });
  }
});

describe('duplicate filter (#798)', () => {
  it('a replay storm is suppressed for as long as it lasts', () => {
    const f = new DuplicateFilter();
    expect(f.isDuplicate('paddle five three hundred', 0)).toBe(false);
    expect(f.isDuplicate('paddle five three hundred', 1000)).toBe(true);
    expect(f.isDuplicate('paddle five three hundred', 2000)).toBe(true);
    expect(f.isDuplicate('paddle five three hundred', 4000)).toBe(false);
  });

  it('keys do not collide across room and lot ids or punctuation', () => {
    expect(idempotencyKey('a:b', 'c', 0, 'x')).not.toBe(idempotencyKey('a', 'b:c', 0, 'x'));
    expect(idempotencyKey('r', 'l', 0, 'Three hundred')).toBe(
      idempotencyKey('r', 'l', 0, 'three hundred.'),
    );
  });
});

describe('fractional amounts (#799)', () => {
  it('sub-cent decimals are not rounded to a whole-dollar bid', () => {
    expect(parseBid('350.004', ctx).status).toBe('confirm');
    expect(parseBid('350.001', ctx).amountCents).not.toBe(35000);
  });
  it('"five and a half" is a fractional amount, not $5', () => {
    const r = parseBid('five and a half', ctx);
    expect(r.status).toBe('confirm');
    expect(r.reason).toBe('fractional_amount');
    expect(r.candidates.map((c) => c.amountCents)).toEqual([550]);
  });
  it('"three hundred and a half" keeps the half', () => {
    expect(parseBid('three hundred and a half', ctx).amountCents).toBe(30050);
  });
  it('exact cents still bid', () => {
    expect(parseBid('350.50', ctx).amountCents).toBe(35050);
  });
});

describe('implausible magnitudes (#831)', () => {
  for (const text of ['two trillion', 'ten mil']) {
    it(`"${text}" needs confirmation`, () => {
      const base = parseBid(text, ctx);
      expect(refineAmounts(text, ctx, base).reason).toBe('implausible_amount');
    });
  }
});

describe('LLM output and result bounds (#801)', () => {
  const good = {
    is_bid: true,
    paddle: '7',
    amount_dollars: 350,
    currency: 'USD',
    alternatives: [],
    is_correction: false,
    negated: false,
    confidence: 0.9,
  };
  it('rejects negative, huge and non-numeric values', () => {
    expect(parseLlmOutput({ ...good, amount_dollars: -300 })).toBeNull();
    expect(parseLlmOutput({ ...good, amount_dollars: 1e300 })).toBeNull();
    expect(parseLlmOutput({ ...good, amount_dollars: 9007199254740993 })).toBeNull();
    expect(parseLlmOutput({ ...good, paddle: 'x'.repeat(500) })).toBeNull();
    expect(parseLlmOutput({ ...good, alternatives: [-1] })).toBeNull();
  });
  it('rejects a bid result without an amount and out-of-range cents', () => {
    const base = parseBid('three hundred', ctx);
    expect(parseResultSchema.safeParse(base).success).toBe(true);
    expect(parseResultSchema.safeParse({ ...base, amountCents: null }).success).toBe(false);
    expect(parseResultSchema.safeParse({ ...base, amountCents: -5 }).success).toBe(false);
    expect(parseResultSchema.safeParse({ ...base, amountCents: 1e30 }).success).toBe(false);
  });
});

describe('event channel overflow (#802)', () => {
  it('keeps finals, errors and state changes when interims can be dropped', async () => {
    const ch = new EventChannel<{ type: string; n: number }>(3);
    ch.push({ type: 'state', n: 0 });
    ch.push({ type: 'interim', n: 1 });
    ch.push({ type: 'final', n: 2 });
    ch.push({ type: 'final', n: 3 });
    ch.push({ type: 'error', n: 4 });
    ch.close();
    const seen: number[] = [];
    for await (const e of ch.iterable()) seen.push(e.n);
    expect(seen).toEqual([0, 2, 3, 4]);
    expect(ch.dropped).toBe(1);
  });
});

describe('frame assembler end of stream (#833)', () => {
  it('flush emits the partial batch padded with silence and marks the end', () => {
    const a = new FrameAssembler();
    a.push(new Int16Array(100).fill(5));
    const out = a.flush();
    expect(out).toHaveLength(1);
    expect((out[0]?.flags ?? 0) & FLAG_END_OF_STREAM).toBe(FLAG_END_OF_STREAM);
    expect(out[0]?.pcm[99]).toBe(5);
    expect(out[0]?.pcm[100]).toBe(0);
    expect(a.flush()).toEqual([]);
  });

  it('ignores a NaN gap', () => {
    const a = new FrameAssembler();
    a.markGap(Number.NaN);
    const b = a.push(new Int16Array(1600));
    const c = a.push(new Int16Array(1600));
    expect(b[0]?.tsMs).toBe(0);
    expect(c[0]?.tsMs).toBe(100);
  });
});
