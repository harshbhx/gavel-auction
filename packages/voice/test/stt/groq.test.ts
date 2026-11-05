import { describe, expect, it } from 'vitest';
import { FRAME_SAMPLES, type AudioBatch } from '../../src/audio/frame.js';
import {
  GroqStt,
  classifyHttpStatus,
  confidenceFromLogprob,
  type FetchLike,
} from '../../src/stt/groq.js';
import type { SttEvent } from '../../src/stt/provider.js';
import { runConformance } from './conformance.js';

type Reply = { ok: boolean; status: number; body: unknown };

function mockFetch(replies: Reply[]): {
  fetch: FetchLike;
  calls: Array<{ url: string; auth: string }>;
} {
  const calls: Array<{ url: string; auth: string }> = [];
  let i = 0;
  const fetch: FetchLike = (url, init) => {
    calls.push({ url, auth: init.headers['authorization'] ?? '' });
    const r = replies[Math.min(i, replies.length - 1)] ?? { ok: true, status: 200, body: {} };
    i += 1;
    return Promise.resolve({ ok: r.ok, status: r.status, json: () => Promise.resolve(r.body) });
  };
  return { fetch, calls };
}

/** 20 ms frames: loud tone for `loudMs`, then silence for `quietMs`, delivered in 100 ms batches. */
function speechBatches(loudMs: number, quietMs: number, leadMs = 400): AudioBatch[] {
  const frames: Int16Array[] = [];
  const quiet = (): Int16Array => new Int16Array(FRAME_SAMPLES);
  const loud = (): Int16Array => {
    const f = new Int16Array(FRAME_SAMPLES);
    for (let i = 0; i < f.length; i++) f[i] = i % 2 === 0 ? 12000 : -12000;
    return f;
  };
  for (let t = 0; t < leadMs; t += 20) frames.push(quiet());
  for (let t = 0; t < loudMs; t += 20) frames.push(loud());
  for (let t = 0; t < quietMs; t += 20) frames.push(quiet());
  const out: AudioBatch[] = [];
  for (let i = 0; i < frames.length; i += 5) {
    const group = frames.slice(i, i + 5);
    const pcm = new Int16Array(group.length * FRAME_SAMPLES);
    group.forEach((f, k) => pcm.set(f, k * FRAME_SAMPLES));
    out.push({ seq: out.length, tsMs: out.length * 100, flags: 0, pcm });
  }
  return out;
}

async function run(
  replies: Reply[],
): Promise<{ events: SttEvent[]; calls: number; groq: GroqStt }> {
  const m = mockFetch(replies);
  const groq = new GroqStt({ apiKey: 'test-key', fetch: m.fetch });
  const events: SttEvent[] = [];
  const reader = (async () => {
    for await (const e of groq.events()) events.push(e);
  })();
  await groq.start();
  for (const b of speechBatches(1200, 800)) groq.write(b);
  await groq.stop();
  await reader;
  return { events, calls: m.calls.length, groq };
}

runConformance('GroqStt', () => {
  const m = mockFetch([{ ok: true, status: 200, body: { text: 'ok' } }]);
  return {
    provider: new GroqStt({ apiKey: 'test-key', fetch: m.fetch }),
    advance: () => Promise.resolve(),
  };
});

describe('T-VOX-018 chunked transcription', () => {
  it('emits one final for a chunk, no interims, empty words, derived confidence', async () => {
    const { events, calls, groq } = await run([
      { ok: true, status: 200, body: { text: 'three fifty' } },
    ]);
    expect(calls).toBe(1);
    const finals = events.filter((e) => e.type === 'final');
    expect(finals).toHaveLength(1);
    const f = finals[0];
    expect(f?.type === 'final' && f.text).toBe('three fifty');
    expect(f?.type === 'final' && f.words).toEqual([]);
    expect(f?.type === 'final' && f.confidence).toBe(0.5);
    expect(events.some((e) => e.type === 'interim')).toBe(false);
    expect(groq.stats.counters.finals).toBe(1);
    expect(groq.stats.latency.count).toBe(1);
  });

  it('429 and 5xx are retryable errors, 401 and 403 are not', async () => {
    const r429 = await run([{ ok: false, status: 429, body: {} }]);
    expect(r429.events).toContainEqual({ type: 'error', code: 'rate_limited', retryable: true });
    const r503 = await run([{ ok: false, status: 503, body: {} }]);
    expect(r503.events).toContainEqual({ type: 'error', code: 'unknown', retryable: true });
    const r401 = await run([{ ok: false, status: 401, body: {} }]);
    expect(r401.events).toContainEqual({ type: 'error', code: 'auth', retryable: false });
    expect(classifyHttpStatus(403)).toEqual({ code: 'auth', retryable: false });
    expect(r401.groq.stats.counters.errors).toBe(1);
  });

  it('a thrown fetch becomes a retryable closed error', async () => {
    const groq = new GroqStt({
      apiKey: 'test-key',
      fetch: () => Promise.reject(new Error('offline')),
    });
    const events: SttEvent[] = [];
    const reader = (async () => {
      for await (const e of groq.events()) events.push(e);
    })();
    await groq.start();
    for (const b of speechBatches(1200, 800)) groq.write(b);
    await groq.stop();
    await reader;
    expect(events).toContainEqual({ type: 'error', code: 'closed', retryable: true });
  });

  it('a body without text is a retryable error and an empty text is ignored', async () => {
    const bad = await run([{ ok: true, status: 200, body: { nope: 1 } }]);
    expect(bad.events).toContainEqual({ type: 'error', code: 'unknown', retryable: true });
    const empty = await run([{ ok: true, status: 200, body: { text: '  ' } }]);
    expect(empty.events.some((e) => e.type === 'final')).toBe(false);
  });

  it('sends the key only in the authorization header', async () => {
    const m = mockFetch([{ ok: true, status: 200, body: { text: 'x' } }]);
    const groq = new GroqStt({ apiKey: 'test-key', fetch: m.fetch });
    await groq.start();
    for (const b of speechBatches(1200, 800)) groq.write(b);
    await groq.stop();
    expect(m.calls[0]?.auth).toBe('Bearer test-key');
    expect(m.calls[0]?.url).not.toContain('test-key');
  });
});

describe('T-VOX-024 derived confidence', () => {
  it('exp(avg_logprob) clamped and rounded to two decimals', () => {
    expect(confidenceFromLogprob(-0.1)).toBe(0.9);
    expect(confidenceFromLogprob(-3)).toBe(0.05);
    expect(confidenceFromLogprob(0.5)).toBe(1);
    expect(confidenceFromLogprob(Number.NaN)).toBe(0.5);
  });

  it('averages segment logprobs into the final event', async () => {
    const { events } = await run([
      {
        ok: true,
        status: 200,
        body: { text: 'bid', segments: [{ avg_logprob: -0.1 }, { avg_logprob: -0.1 }] },
      },
    ]);
    const f = events.find((e) => e.type === 'final');
    expect(f?.type === 'final' && f.confidence).toBe(0.9);
  });
});
