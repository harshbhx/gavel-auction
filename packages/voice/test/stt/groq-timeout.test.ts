import { describe, expect, it } from 'vitest';
import { FRAME_SAMPLES, type AudioBatch } from '../../src/audio/frame.js';
import { GroqStt, type FetchLike } from '../../src/stt/groq.js';
import type { SttEvent } from '../../src/stt/provider.js';

function batches(): AudioBatch[] {
  const frames: Int16Array[] = [];
  for (let t = 0; t < 400; t += 20) frames.push(new Int16Array(FRAME_SAMPLES));
  for (let t = 0; t < 1200; t += 20) {
    const f = new Int16Array(FRAME_SAMPLES);
    for (let i = 0; i < f.length; i++) f[i] = i % 2 === 0 ? 12000 : -12000;
    frames.push(f);
  }
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
  fetch: FetchLike,
  extra: { requestTimeoutMs?: number; stopDeadlineMs?: number; retryBackoffMs?: number },
) {
  const groq = new GroqStt({ apiKey: 'k'.repeat(8), fetch, ...extra });
  const events: SttEvent[] = [];
  const reader = (async () => {
    for await (const e of groq.events()) events.push(e);
  })();
  await groq.start();
  for (const b of batches()) groq.write(b);
  await groq.stop();
  await reader;
  return events;
}

describe('R8-V01 groq request timeout', () => {
  it('a never-resolving fetch yields a retryable timeout and stop() returns', async () => {
    let signal: AbortSignal | undefined;
    const fetch: FetchLike = (_u, init) => {
      signal = init.signal;
      return new Promise(() => undefined);
    };
    const events = await run(fetch, {
      requestTimeoutMs: 20,
      stopDeadlineMs: 500,
      retryBackoffMs: 1,
    });
    expect(events).toContainEqual({ type: 'error', code: 'timeout', retryable: true });
    expect(signal?.aborted).toBe(true);
    expect(events[events.length - 1]).toEqual({ type: 'state', state: 'closed' });
  });

  it('stop() is bounded by its deadline even if the request timer is long', async () => {
    const fetch: FetchLike = () => new Promise(() => undefined);
    const events = await run(fetch, { requestTimeoutMs: 60000, stopDeadlineMs: 30 });
    expect(events[events.length - 1]).toEqual({ type: 'state', state: 'closed' });
  });
});
