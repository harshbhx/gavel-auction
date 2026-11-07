import { describe, expect, it } from 'vitest';
import { FRAME_SAMPLES, type AudioBatch } from '../../src/audio/frame.js';
import { GROQ_BID_PROMPT, GroqStt, type FetchLike } from '../../src/stt/groq.js';

function batches(): AudioBatch[] {
  const quiet = (): Int16Array => new Int16Array(FRAME_SAMPLES);
  const loud = (): Int16Array => {
    const f = new Int16Array(FRAME_SAMPLES);
    for (let i = 0; i < f.length; i++) f[i] = i % 2 === 0 ? 12000 : -12000;
    return f;
  };
  const frames: Int16Array[] = [];
  for (let t = 0; t < 400; t += 20) frames.push(quiet());
  for (let t = 0; t < 1200; t += 20) frames.push(loud());
  for (let t = 0; t < 800; t += 20) frames.push(quiet());
  const out: AudioBatch[] = [];
  for (let i = 0; i < frames.length; i += 5) {
    const group = frames.slice(i, i + 5);
    const pcm = new Int16Array(group.length * FRAME_SAMPLES);
    group.forEach((f, k) => pcm.set(f, k * FRAME_SAMPLES));
    out.push({ seq: out.length, tsMs: out.length * 100, flags: 0, pcm });
  }
  return out;
}

async function promptSent(prompt?: string | null): Promise<FormDataEntryValue | null> {
  const bodies: FormData[] = [];
  const fetch: FetchLike = (_url, init) => {
    bodies.push(init.body);
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ text: 'x' }) });
  };
  const groq = new GroqStt({
    apiKey: 'test-key',
    fetch,
    ...(prompt === undefined ? {} : { prompt }),
  });
  const reader = (async () => {
    for await (const e of groq.events()) void e;
  })();
  await groq.start();
  for (const b of batches()) groq.write(b);
  await groq.stop();
  await reader;
  return bodies[0]?.get('prompt') ?? null;
}

describe('Groq vocabulary hint', () => {
  it('sends the bid-words hint by default, and it carries no amounts', async () => {
    expect(await promptSent()).toBe(GROQ_BID_PROMPT);
    expect(GROQ_BID_PROMPT).not.toMatch(/\d/);
    expect(GROQ_BID_PROMPT).not.toMatch(/\b(fifty|twenty|eight|six|seven|five)\b/i);
  });

  it('sends a given prompt, or none when the prompt is null', async () => {
    expect(await promptSent('Paddle numbers.')).toBe('Paddle numbers.');
    expect(await promptSent(null)).toBeNull();
  });
});
