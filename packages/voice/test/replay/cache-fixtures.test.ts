import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decide } from '../../src/decide/decide.js';
import { outcomeOf } from '../../src/replay/diff.js';
import { cacheKey, createCache, createDirStore, LlmCacheMissError } from '../../src/llm/cache.js';
import { createLlmClient } from '../../src/llm/client.js';
import { parseUtterance } from '../../src/parser/utterance.js';
import { VirtualClock } from '../../src/stt/fake.js';
import type { SttEvent } from '../../src/stt/provider.js';
import { ReplayStt, parseTimeline, type ExpectedOutcome } from '../../src/stt/replay.js';
import type { BidContext } from '../../src/types.js';

const fixtures = new URL('../../fixtures/', import.meta.url);
const sttPath = (provider: string, n: number): URL =>
  new URL(`stt-cache/${provider}-u${n}.json`, fixtures);

const promptContext = {
  currentPriceCents: 25_000,
  minIncrementCents: 2_500,
  registeredPaddles: ['4', '7', '12'],
  speakerKnown: false,
  previousSegment: null,
};
const lines = [
  'Bidder four, three hundred.',
  'Three fifty or maybe four hundred, I am not sure.',
  'Let me think about that for a moment.',
];

const ctx: BidContext = {
  nowMs: 30_000,
  lotState: 'OPEN',
  currentPriceCents: 25_000,
  minIncrementCents: 2_500,
  highBidderId: null,
  roster: new Map([
    ['4', { bidderId: 'b4', ceilingCents: 1_000_000, holdActive: true }],
    ['7', { bidderId: 'b7', ceilingCents: 1_000_000, holdActive: true }],
  ]),
  recent: [],
};

interface CachedUtterance {
  provider: string;
  utterance: number;
  startMs: number;
  endMs: number;
  source: string;
  events: Array<{ atMs: number; event: SttEvent }>;
}

function load(provider: string, n: number): CachedUtterance {
  return JSON.parse(readFileSync(sttPath(provider, n), 'utf8')) as CachedUtterance;
}

const placeholder: ExpectedOutcome = { kind: 'drop', bidderId: null, amountCents: null };

async function runOnce(provider: string): Promise<{
  finalAt: number[];
  outcomes: ExpectedOutcome[];
  decisions: unknown[];
}> {
  const all = [1, 2, 3].map((n) => load(provider, n));
  const timeline = parseTimeline({
    utterances: all.map((u) => ({
      startMs: u.startMs,
      endMs: u.endMs,
      expected: placeholder,
      events: u.events,
    })),
  });
  const clock = new VirtualClock();
  const stt = new ReplayStt(timeline, clock);
  const finalAt: number[] = [];
  const outcomes: ExpectedOutcome[] = [];
  const decisions: unknown[] = [];
  const done = (async () => {
    for await (const event of stt.events()) {
      if (event.type !== 'final') continue;
      finalAt.push(clock.now());
      const parse = parseUtterance(event.text, {
        currentPriceCents: ctx.currentPriceCents,
        minIncrementCents: ctx.minIncrementCents,
      });
      const d = decide(
        {
          segmentId: `s${finalAt.length}`,
          idempotencyKey: `room:lot:${event.startMs}:${finalAt.length}`,
          transcript: event.text,
          audioStartMs: event.startMs,
          audioEndMs: event.endMs,
          sttProvider: stt.name,
          sttConfidence: event.confidence,
          replay: true,
        },
        parse,
        parse,
        ctx,
      );
      decisions.push(d);
      outcomes.push(outcomeOf(d));
    }
  })();
  await stt.start();
  for (let t = 0; t < 21_000; t += 50) {
    clock.advance(50);
    for (let i = 0; i < 5; i++) await Promise.resolve();
  }
  await done;
  return { finalAt, outcomes, decisions };
}

describe('stt cache fixtures (R-VOX-082)', () => {
  it('has one file per utterance per provider, all marked with their provenance', () => {
    for (const provider of ['deepgram', 'groq']) {
      for (const n of [1, 2, 3]) {
        expect(existsSync(sttPath(provider, n))).toBe(true);
        const u = load(provider, n);
        expect(u.provider).toBe(provider);
        expect(u.utterance).toBe(n);
        expect(u.source).toBe('reference-transcript');
      }
    }
  });
});

describe('T-VOX-067 llm cache fixtures (R-VOX-060)', () => {
  const dir = new URL('model-cache', fixtures).pathname;
  const fs = {
    readFileSync: (p: string, e: 'utf8') => readFileSync(p, e),
    writeFileSync: (p: string, d: string) => {
      writeFileSync(p, d);
    },
    mkdirSync: (p: string, o: { recursive: true }) => mkdirSync(p, o),
    existsSync,
  };

  it('a recorded entry exists under sha256(transcript + context) for every utterance', async () => {
    const cache = createCache(createDirStore(dir, fs));
    for (const transcript of lines) {
      const key = await cacheKey(transcript, promptContext);
      expect(key).toMatch(/^[0-9a-f]{64}$/);
      expect(cache.get(key)).toBeDefined();
    }
  });

  it('replay returns the recorded output without a transport', async () => {
    const client = createLlmClient({
      mode: 'replay',
      cache: createCache(createDirStore(dir, fs)),
    });
    const out = await client.parse(
      { transcript: lines[0] ?? '', ...promptContext },
      new AbortController().signal,
    );
    expect(out.is_bid).toBe(true);
    expect(out.paddle).toBe('4');
    expect(out.amount_dollars).toBe(300);
  });

  it('a miss throws a typed error and does not touch the network', async () => {
    const client = createLlmClient({
      mode: 'replay',
      cache: createCache(createDirStore(dir, fs)),
    });
    await expect(
      client.parse(
        { transcript: 'paddle nine, nine hundred', ...promptContext },
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(LlmCacheMissError);
  });
});

describe('cached replay end to end (R-VOX-081, R-VOX-102)', () => {
  it('delivers each final at its recorded offset (within 300 ms) and decides as expected', async () => {
    const run = await runOnce('deepgram');
    const recorded = [1, 2, 3].map(
      (n) => load('deepgram', n).events.find((e) => e.event.type === 'final')?.atMs ?? -1,
    );
    expect(run.finalAt).toHaveLength(3);
    run.finalAt.forEach((at, i) => {
      expect(Math.abs(at - (recorded[i] ?? -1))).toBeLessThanOrEqual(300);
    });
    expect(run.outcomes.map((o) => o.kind)).toEqual(['accept', 'confirm', 'confirm']);
    expect(run.outcomes[0]).toEqual({ kind: 'accept', bidderId: 'b4', amountCents: 30_000 });
  });

  it('a second run gives identical decisions', async () => {
    const a = await runOnce('deepgram');
    const b = await runOnce('deepgram');
    expect(b.decisions).toEqual(a.decisions);
    expect(b.finalAt).toEqual(a.finalAt);
  });

  it('both providers decide the same', async () => {
    const dg = await runOnce('deepgram');
    const gq = await runOnce('groq');
    expect(gq.outcomes).toEqual(dg.outcomes);
  });
});
