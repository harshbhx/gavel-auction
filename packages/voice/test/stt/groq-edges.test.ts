import { describe, expect, it } from 'vitest';
import {
  FLAG_DISCONTINUITY,
  FLAG_END_OF_STREAM,
  FLAG_KEEPALIVE,
  FRAME_SAMPLES,
  type AudioBatch,
} from '../../src/audio/frame.js';
import { GroqStt, type FetchLike } from '../../src/stt/groq.js';
import type { SttEvent } from '../../src/stt/provider.js';

function fakeFetch(): { fetch: FetchLike; count: () => number } {
  let n = 0;
  const fetch: FetchLike = () => {
    n += 1;
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ text: `chunk ${n}` }),
    });
  };
  return { fetch, count: () => n };
}

const BATCH_FRAMES = 5;
const BATCH_MS = (BATCH_FRAMES * FRAME_SAMPLES * 1000) / 16000;

function batch(kind: 'quiet' | 'loud', tsMs: number, flags = 0): AudioBatch {
  const pcm = new Int16Array(BATCH_FRAMES * FRAME_SAMPLES);
  if (kind === 'loud') for (let i = 0; i < pcm.length; i++) pcm[i] = i % 2 === 0 ? 12000 : -12000;
  return { seq: tsMs, tsMs, flags, pcm };
}

async function collect(groq: GroqStt, body: () => Promise<void> | void): Promise<SttEvent[]> {
  const events: SttEvent[] = [];
  const reader = (async () => {
    for await (const e of groq.events()) events.push(e);
  })();
  await groq.start();
  await body();
  await groq.stop();
  await reader;
  return events;
}

function finals(events: SttEvent[]): Array<Extract<SttEvent, { type: 'final' }>> {
  return events.filter((e): e is Extract<SttEvent, { type: 'final' }> => e.type === 'final');
}

describe('R7-06 end of stream and stop', () => {
  it('transcribes speech still inside the hangover when the stream ends', async () => {
    const f = fakeFetch();
    const groq = new GroqStt({ apiKey: 'k', fetch: f.fetch });
    const events = await collect(groq, () => {
      let t = 0;
      for (let i = 0; i < 4; i++, t += BATCH_MS) groq.write(batch('quiet', t));
      for (let i = 0; i < 6; i++, t += BATCH_MS) groq.write(batch('loud', t));
      groq.write(batch('quiet', t, FLAG_END_OF_STREAM));
    });
    expect(finals(events)).toHaveLength(1);
    expect(events.some((e) => e.type === 'utterance_end')).toBe(true);
  });

  it('stop sends the held speech and every queued chunk', async () => {
    const f = fakeFetch();
    const groq = new GroqStt({ apiKey: 'k', fetch: f.fetch });
    const events = await collect(groq, () => {
      let t = 0;
      // two complete utterances queue up behind the first request, then a third is held.
      for (let u = 0; u < 3; u++) {
        for (let i = 0; i < 2; i++, t += BATCH_MS) groq.write(batch('quiet', t));
        for (let i = 0; i < 6; i++, t += BATCH_MS) groq.write(batch('loud', t));
        if (u < 2) for (let i = 0; i < 8; i++, t += BATCH_MS) groq.write(batch('quiet', t));
      }
    });
    expect(finals(events)).toHaveLength(3);
    expect(f.count()).toBe(3);
  });
});

describe('R7-11 batch timestamps, discontinuity and keepalive', () => {
  it('times a chunk from the batch timestamp, not from counted samples', async () => {
    const f = fakeFetch();
    const groq = new GroqStt({ apiKey: 'k', fetch: f.fetch });
    const events = await collect(groq, () => {
      groq.write(batch('quiet', 5000, FLAG_DISCONTINUITY));
      let t = 5000 + BATCH_MS;
      for (let i = 0; i < 6; i++, t += BATCH_MS) groq.write(batch('loud', t));
      groq.write(batch('quiet', t, FLAG_END_OF_STREAM));
    });
    const [first] = finals(events);
    expect(first).toBeDefined();
    expect(first?.startMs).toBeGreaterThanOrEqual(5000);
    expect(first?.endMs).toBeGreaterThan(first?.startMs ?? 0);
  });

  it('never joins audio on both sides of a dropped gap', async () => {
    const f = fakeFetch();
    const groq = new GroqStt({ apiKey: 'k', fetch: f.fetch });
    const events = await collect(groq, () => {
      let t = 0;
      for (let i = 0; i < 6; i++, t += BATCH_MS) groq.write(batch('loud', t));
      t += 2000;
      for (let i = 0; i < 6; i++, t += BATCH_MS) {
        groq.write(batch('loud', t, i === 0 ? FLAG_DISCONTINUITY : 0));
      }
    });
    const out = finals(events);
    expect(out).toHaveLength(2);
    expect(out[1]?.startMs).toBeGreaterThanOrEqual(2000);
  });

  it('advances the clock over keepalives so utterance_end is not early', async () => {
    const f = fakeFetch();
    const groq = new GroqStt({ apiKey: 'k', fetch: f.fetch });
    const events = await collect(groq, () => {
      groq.write(batch('quiet', 0));
      groq.write({ seq: 1, tsMs: 30000, flags: FLAG_KEEPALIVE, pcm: new Int16Array(0) });
      groq.write(batch('quiet', 30000, FLAG_END_OF_STREAM));
    });
    const end = events.find((e) => e.type === 'utterance_end');
    expect(end?.type === 'utterance_end' && end.atMs).toBeGreaterThanOrEqual(30000);
  });
});
