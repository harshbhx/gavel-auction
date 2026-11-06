import { describe, expect, it } from 'vitest';
import { FRAME_SAMPLES, type AudioBatch } from '../../src/audio/frame.js';
import { GroqStt, GROQ_MAX_RETRIES, type FetchLike } from '../../src/stt/groq.js';
import type { SttEvent } from '../../src/stt/provider.js';

function speech(): AudioBatch[] {
  const frames: Int16Array[] = [];
  const loud = (): Int16Array => {
    const f = new Int16Array(FRAME_SAMPLES);
    for (let i = 0; i < f.length; i++) f[i] = i % 2 === 0 ? 12000 : -12000;
    return f;
  };
  for (let t = 0; t < 400; t += 20) frames.push(new Int16Array(FRAME_SAMPLES));
  for (let t = 0; t < 1200; t += 20) frames.push(loud());
  for (let t = 0; t < 800; t += 20) frames.push(new Int16Array(FRAME_SAMPLES));
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
  statuses: number[],
): Promise<{ events: SttEvent[]; calls: number; groq: GroqStt }> {
  let calls = 0;
  const fetch: FetchLike = () => {
    const status = statuses[Math.min(calls, statuses.length - 1)] ?? 200;
    calls += 1;
    return Promise.resolve({
      ok: status === 200,
      status,
      json: () => Promise.resolve({ text: 'paddle seven eight hundred' }),
    });
  };
  const groq = new GroqStt({ apiKey: 'test-key', fetch, retryBackoffMs: 1 });
  const events: SttEvent[] = [];
  const reader = (async () => {
    for await (const e of groq.events()) events.push(e);
  })();
  await groq.start();
  for (const b of speech()) groq.write(b);
  await groq.stop();
  await reader;
  return { events, calls, groq };
}

describe('groq retries a retryable failure instead of losing the chunk', () => {
  it('a 429 followed by success still yields the final', async () => {
    const r = await run([429, 200]);
    expect(r.calls).toBe(2);
    expect(r.events.filter((e) => e.type === 'final')).toHaveLength(1);
    expect(r.groq.stats.counters.droppedBatches).toBe(0);
  });

  it('a 503 is retried a bounded number of times, then counted as lost', async () => {
    const r = await run([503]);
    expect(r.calls).toBe(1 + GROQ_MAX_RETRIES);
    expect(r.events.some((e) => e.type === 'final')).toBe(false);
    expect(r.groq.stats.counters.droppedBatches).toBe(1);
  });

  it('a non-retryable 401 is not retried', async () => {
    const r = await run([401]);
    expect(r.calls).toBe(1);
  });
});
