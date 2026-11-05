import { describe, expect, it } from 'vitest';
import { Endpointer } from '../../src/audio/endpointer.js';
import { FRAME_SAMPLES } from '../../src/audio/frame.js';
import { encodeWav } from '../../src/audio/wav.js';

const SAMPLE_RATE = 16000;

function makeBatch(pcm: Int16Array, seq: number, tsMs: number) {
  return { seq, tsMs, flags: 0, pcm };
}

function sineSamples(amplitude: number, samples: number): Int16Array {
  const buf = new Int16Array(samples);
  for (let i = 0; i < samples; i++) {
    buf[i] = Math.round(amplitude * 32767 * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE));
  }
  return buf;
}

function silenceSamples(samples: number): Int16Array {
  return new Int16Array(samples);
}

function feedInFrames(
  ep: Endpointer,
  pcm: Int16Array,
  startSeq: number,
  startMs: number,
): ReturnType<Endpointer['push']> {
  const allChunks: ReturnType<Endpointer['push']> = [];
  for (let i = 0; i < pcm.length; i += FRAME_SAMPLES) {
    const end = Math.min(i + FRAME_SAMPLES, pcm.length);
    const batch = makeBatch(pcm.slice(i, end), startSeq++, startMs + (i / SAMPLE_RATE) * 1000);
    const chunks = ep.push(batch);
    allChunks.push(...chunks);
  }
  return allChunks;
}

describe('Endpointer (T-VOX-017)', () => {
  it('produces two chunks from tone-silence-tone', () => {
    const ep = new Endpointer();
    const silence0 = silenceSamples(SAMPLE_RATE);
    feedInFrames(ep, silence0, 0, 0);

    const tone1 = sineSamples(0.8, SAMPLE_RATE);
    const gap = silenceSamples(Math.ceil(SAMPLE_RATE * 0.7));
    const tone2 = sineSamples(0.8, SAMPLE_RATE * 2);
    const trailing = silenceSamples(SAMPLE_RATE);

    const combined = new Int16Array(tone1.length + gap.length + tone2.length + trailing.length);
    combined.set(tone1);
    combined.set(gap, tone1.length);
    combined.set(tone2, tone1.length + gap.length);
    combined.set(trailing, tone1.length + gap.length + tone2.length);

    const chunks = feedInFrames(ep, combined, 50, 1000);
    expect(chunks.length).toBe(2);
  });

  it('cuts at 8 s for continuous tone', () => {
    const ep = new Endpointer();
    const silence0 = silenceSamples(SAMPLE_RATE);
    feedInFrames(ep, silence0, 0, 0);

    const longTone = sineSamples(0.8, SAMPLE_RATE * 10);
    const trailing = silenceSamples(SAMPLE_RATE);
    const combined = new Int16Array(longTone.length + trailing.length);
    combined.set(longTone);
    combined.set(trailing, longTone.length);

    const chunks = feedInFrames(ep, combined, 50, 1000);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    const firstChunk = chunks[0];
    expect(firstChunk).toBeDefined();
    const maxSamples = SAMPLE_RATE * 8;
    expect(firstChunk?.pcm.length).toBeLessThanOrEqual(maxSamples + SAMPLE_RATE);
  });

  it('drops tone shorter than 150 ms and counts it', () => {
    const ep = new Endpointer();
    const silence0 = silenceSamples(SAMPLE_RATE);
    feedInFrames(ep, silence0, 0, 0);

    const shortTone = sineSamples(0.8, Math.floor(SAMPLE_RATE * 0.1));
    const trailing = silenceSamples(SAMPLE_RATE);
    const combined = new Int16Array(shortTone.length + trailing.length);
    combined.set(shortTone);
    combined.set(trailing, shortTone.length);

    const chunks = feedInFrames(ep, combined, 50, 1000);
    expect(chunks.length).toBe(0);
    expect(ep.discardedChunks).toBe(1);
  });

  it('keeps a 250 ms spoken answer (R8-V06)', () => {
    const ep = new Endpointer();
    feedInFrames(ep, silenceSamples(SAMPLE_RATE), 0, 0);
    const tone = sineSamples(0.8, Math.floor(SAMPLE_RATE * 0.25));
    const combined = new Int16Array(tone.length + SAMPLE_RATE);
    combined.set(tone);
    expect(feedInFrames(ep, combined, 50, 1000)).toHaveLength(1);
  });

  it('recovers from steady -35 dBFS noise that starts after a quiet second (R8-V02)', () => {
    const ep = new Endpointer();
    feedInFrames(ep, silenceSamples(SAMPLE_RATE), 0, 0);
    // -35 dBFS RMS: amplitude 0.0178 of full scale, times sqrt(2) for a sine peak.
    const noise = sineSamples(0.0178 * Math.SQRT2, SAMPLE_RATE * 30);
    const chunks = feedInFrames(ep, noise, 50, 1000);
    // The first window may emit one chunk before the floor catches up; never a run of 8 s chunks.
    expect(chunks.length).toBeLessThanOrEqual(1);
  });
});

describe('WAV encoder (T-VOX-017)', () => {
  it('produces a valid 44-byte header for 16 kHz mono 16-bit', () => {
    const pcm = sineSamples(0.5, 1600);
    const wav = encodeWav(pcm);

    expect(wav.length).toBe(44 + pcm.length * 2);

    const view = new DataView(wav.buffer);
    expect(String.fromCharCode(wav[0] ?? 0, wav[1] ?? 0, wav[2] ?? 0, wav[3] ?? 0)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(36 + pcm.length * 2);
    expect(String.fromCharCode(wav[8] ?? 0, wav[9] ?? 0, wav[10] ?? 0, wav[11] ?? 0)).toBe('WAVE');
    expect(String.fromCharCode(wav[12] ?? 0, wav[13] ?? 0, wav[14] ?? 0, wav[15] ?? 0)).toBe(
      'fmt ',
    );
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(String.fromCharCode(wav[36] ?? 0, wav[37] ?? 0, wav[38] ?? 0, wav[39] ?? 0)).toBe(
      'data',
    );
    expect(view.getUint32(40, true)).toBe(pcm.length * 2);
  });
});

function noise(samples: number, amplitude: number, seed: number): Int16Array {
  const buf = new Int16Array(samples);
  let x = seed;
  for (let i = 0; i < samples; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    buf[i] = Math.round((x / 0x7fffffff - 0.5) * 2 * amplitude);
  }
  return buf;
}

/** Noise at about -55 dBFS RMS with an optional 440 Hz tone at about -25 dBFS RMS on top. */
function room(samples: number, seed: number, speech: boolean): Int16Array {
  const n = noise(samples, 100, seed);
  if (!speech) return n;
  const tone = sineSamples(0.0795, samples);
  for (let i = 0; i < samples; i++) n[i] = (n[i] ?? 0) + (tone[i] ?? 0);
  return n;
}

function join(...parts: Int16Array[]): Int16Array {
  const out = new Int16Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

describe('Endpointer in a real room (R7-07)', () => {
  it('detects speech at -25 dBFS over a -55 dBFS noise floor', () => {
    const ep = new Endpointer();
    const pcm = join(
      room(SAMPLE_RATE, 1, false),
      room(SAMPLE_RATE, 2, true),
      room(SAMPLE_RATE, 3, false),
    );
    expect(feedInFrames(ep, pcm, 0, 0).length).toBe(1);
  });

  it('detects speech that is already playing when the stream opens', () => {
    const ep = new Endpointer();
    const pcm = join(room(SAMPLE_RATE, 4, true), room(SAMPLE_RATE, 5, false));
    expect(feedInFrames(ep, pcm, 0, 0).length).toBe(1);
  });

  it('stays quiet on noise alone', () => {
    const ep = new Endpointer();
    expect(feedInFrames(ep, room(SAMPLE_RATE * 2, 6, false), 0, 0).length).toBe(0);
  });
});

describe('Endpointer flush (R7-06)', () => {
  it('emits speech cut off inside the hangover', () => {
    const ep = new Endpointer();
    const pcm = join(
      silenceSamples(SAMPLE_RATE),
      sineSamples(0.8, SAMPLE_RATE),
      silenceSamples(Math.floor(SAMPLE_RATE * 0.2)),
    );
    expect(feedInFrames(ep, pcm, 0, 0).length).toBe(0);
    const flushed = ep.flush();
    expect(flushed.length).toBe(1);
    expect(flushed[0]?.pcm.length).toBeGreaterThan(SAMPLE_RATE * 0.9);
    expect(ep.flush()).toEqual([]);
  });

  it('drops held speech shorter than the minimum and is a no-op when idle', () => {
    const ep = new Endpointer();
    expect(ep.flush()).toEqual([]);
    feedInFrames(ep, join(silenceSamples(SAMPLE_RATE), sineSamples(0.8, 2000)), 0, 0);
    expect(ep.flush()).toEqual([]);
  });
});
