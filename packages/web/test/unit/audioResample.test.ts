import { describe, expect, it } from 'vitest';
import { createResampler, TARGET_RATE } from '../../src/audio/resample';

function ramp(n: number, rate: number): Float32Array {
  // A slow sine so linear interpolation is close to exact.
  return Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 200 * i) / rate));
}

function concat(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

describe('streaming resampler to 16 kHz', () => {
  it('returns the same block at 16 kHz', () => {
    const block = ramp(128, TARGET_RATE);
    expect(createResampler(TARGET_RATE).process(block)).toBe(block);
  });

  it.each([44100, 48000, 24000, 8000, 96000])('keeps the duration at %i Hz', (rate) => {
    const r = createResampler(rate);
    const blocks = Math.floor((rate * 2) / 128);
    let out = 0;
    for (let i = 0; i < blocks; i += 1) out += r.process(ramp(128, rate)).length;
    const expected = (blocks * 128) / (rate / TARGET_RATE);
    // Within a few output samples of the exact count: nothing is dropped at block edges.
    expect(Math.abs(out - expected)).toBeLessThanOrEqual(3);
  });

  it('gives the same samples whatever the block size', () => {
    const rate = 44100;
    const all = ramp(8820, rate);
    const whole = createResampler(rate).process(all);
    const split = createResampler(rate);
    const parts: Float32Array[] = [];
    for (let at = 0; at < all.length; at += 128)
      parts.push(split.process(all.subarray(at, at + 128)));
    const joined = concat(parts);
    const n = Math.min(whole.length, joined.length);
    expect(n).toBeGreaterThan(3000);
    for (let i = 0; i < n; i += 1) expect(joined[i]).toBeCloseTo(whole[i] ?? 0, 5);
  });

  it('follows a sine closely (no pitch shift)', () => {
    const rate = 48000;
    const out = createResampler(rate).process(ramp(4800, rate));
    for (let i = 5; i < out.length - 5; i += 1) {
      const expected = Math.sin((2 * Math.PI * 200 * i) / TARGET_RATE);
      expect(out[i]).toBeCloseTo(expected, 1);
    }
  });

  it('takes an empty block and refuses odd rates', () => {
    expect(createResampler(48000).process(new Float32Array(0))).toHaveLength(0);
    expect(() => createResampler(1000)).toThrow(RangeError);
    expect(() => createResampler(Number.NaN)).toThrow(RangeError);
  });
});
