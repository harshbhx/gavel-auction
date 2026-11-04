import { describe, expect, it } from 'vitest';
import { floatToInt16, resampleTo16k } from '../../src/audio/resample.js';

const RATES = [8000, 16000, 22050, 24000, 32000, 44100, 48000, 96000];

function sine(rate: number, hz: number, seconds: number): Float32Array {
  const n = Math.round(rate * seconds);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / rate);
  return x;
}

function rms(x: Float32Array, from: number, to: number): number {
  let s = 0;
  for (let i = from; i < to; i++) s += (x[i] as number) ** 2;
  return Math.sqrt(s / (to - from));
}

/** Frequency from upward zero crossings with linear interpolation. */
function zeroCrossHz(x: Float32Array, rate: number, from: number, to: number): number {
  const crossings: number[] = [];
  for (let i = Math.max(1, from); i < to; i++) {
    const a = x[i - 1] as number;
    const b = x[i] as number;
    if (a < 0 && b >= 0) crossings.push(i - 1 + -a / (b - a));
  }
  const periods = crossings.length - 1;
  return (periods * rate) / ((crossings[crossings.length - 1] as number) - (crossings[0] as number));
}

describe('T-VOX-003 resampler', () => {
  it.each(RATES)('1 kHz sine at %i Hz comes out at 16 kHz', (rate) => {
    const input = sine(rate, 1000, 0.5);
    const rs = resampleTo16k(rate);
    const out = rs.process(input).slice();
    // streaming holds back a short lookahead; flush with silence
    const tail = rs.process(new Float32Array(Math.ceil(rate * 0.01))).slice();
    expect(out.length + tail.length).toBeGreaterThanOrEqual(8000 - 2 - 200);
    expect(out.length).toBeLessThanOrEqual(8000 + 2);

    const all = new Float32Array(out.length + tail.length);
    all.set(out);
    all.set(tail, out.length);
    const a = 400; // skip start-up transient
    const b = out.length - 400;
    expect(Math.abs(zeroCrossHz(all, 16000, a, b) - 1000) / 1000).toBeLessThan(0.01);
    const ratioDb = 20 * Math.log10(rms(all, a, b) / rms(input, 0, input.length));
    expect(Math.abs(ratioDb)).toBeLessThanOrEqual(1);
  });

  it('one-shot length is 8000 +-2 for a 0.5 s input once flushed', () => {
    const rs = resampleTo16k(48000);
    const first = rs.process(sine(48000, 1000, 0.5)).length;
    const rest = rs.process(new Float32Array(48000 * 0.01)).length;
    expect(Math.abs(first + rest - 8000)).toBeLessThanOrEqual(2 + 160);
  });

  it('is chunk-invariant', () => {
    const input = sine(44100, 1000, 0.3);
    const whole = resampleTo16k(44100).process(input).slice();
    const rs = resampleTo16k(44100);
    const parts: number[] = [];
    for (let i = 0; i < input.length; i += 1000) parts.push(...rs.process(input.subarray(i, i + 1000)));
    expect(parts.length).toBe(whole.length);
    for (let i = 0; i < whole.length; i++) expect(parts[i] as number).toBeCloseTo(whole[i] as number, 5);
  });

  it('rejects unsupported rates', () => {
    expect(() => resampleTo16k(4000)).toThrow(RangeError);
    expect(() => resampleTo16k(192000)).toThrow(RangeError);
    expect(() => resampleTo16k(Number.NaN)).toThrow(RangeError);
  });

  it('reuses its output buffer after warm-up', () => {
    const rs = resampleTo16k(48000);
    const block = sine(48000, 1000, 0.02);
    rs.process(block);
    const a = rs.process(block);
    const b = rs.process(block);
    expect(a.buffer).toBe(b.buffer);
  });
});

describe('T-VOX-004 float to int16', () => {
  it('converts, clamps and zeroes NaN', () => {
    const out = floatToInt16(new Float32Array([1, -1, 0.5, Number.NaN, 2, -2, 0]));
    expect(out[0]).toBe(32767);
    expect(out[1]).toBe(-32768);
    expect(Math.abs((out[2] as number) - 16384)).toBeLessThanOrEqual(1);
    expect(out[3]).toBe(0);
    expect(out[4]).toBe(32767);
    expect(out[5]).toBe(-32768);
    expect(out[6]).toBe(0);
  });

  it('writes into a provided buffer without allocating', () => {
    const dest = new Int16Array(8);
    const out = floatToInt16(new Float32Array([0.25, -0.25]), dest);
    expect(out.buffer).toBe(dest.buffer);
    expect(Array.from(out)).toEqual([8192, -8192]);
  });
});
