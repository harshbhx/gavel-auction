import { describe, expect, it } from 'vitest';
import { FLAG_DISCONTINUITY, FRAME_SAMPLES } from '../../src/audio/frame.js';
import { FrameAssembler } from '../../src/audio/assembler.js';

describe('T-VOX-006 frame assembler', () => {
  it('turns 1 s of uneven chunks into 10 numbered batches', () => {
    const total = 16000;
    const src = new Int16Array(total).map((_, i) => i % 30000);
    const sizes = [127, 1000, 3333, 1, 4096, 77];
    const a = new FrameAssembler();
    const batches = [];
    let at = 0;
    let s = 0;
    while (at < total) {
      const n = Math.min(sizes[s++ % sizes.length] as number, total - at);
      batches.push(...a.push(src.subarray(at, at + n)));
      at += n;
    }
    expect(batches).toHaveLength(10);
    expect(batches.map((b) => b.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(batches.map((b) => b.tsMs)).toEqual([0, 100, 200, 300, 400, 500, 600, 700, 800, 900]);
    expect(batches.reduce((n, b) => n + b.pcm.length / FRAME_SAMPLES, 0)).toBe(50);
    const joined = new Int16Array(total);
    batches.forEach((b, i) => joined.set(b.pcm, i * 1600));
    expect(Array.from(joined)).toEqual(Array.from(src));
    expect(a.buffered).toBe(0);
  });

  it('holds partial batches and does not alias emitted pcm', () => {
    const a = new FrameAssembler();
    expect(a.push(new Int16Array(1599))).toHaveLength(0);
    const [b1] = a.push(new Int16Array([7]));
    a.push(new Int16Array(1600).fill(9));
    expect(b1?.pcm[0]).toBe(0);
  });

  it('marks gaps with the discontinuity flag and shifts tsMs', () => {
    const a = new FrameAssembler();
    const first = a.push(new Int16Array(1600));
    a.markGap(300);
    const second = a.push(new Int16Array(3200));
    const third = a.push(new Int16Array(1600));
    expect(first[0]?.flags).toBe(0);
    expect(second.map((b) => b.tsMs)).toEqual([400, 500]);
    expect(second[0]?.flags).toBe(FLAG_DISCONTINUITY);
    expect(second[1]?.flags).toBe(0);
    expect(third[0]?.seq).toBe(3);
  });

  it('stamps pre-gap samples before the gap shift (R-VOX-020)', () => {
    const a = new FrameAssembler();
    a.push(new Int16Array(800).fill(5));
    const padded = a.markGap(500);
    expect(padded).toHaveLength(1);
    expect(padded[0]?.tsMs).toBe(0);
    expect(padded[0]?.flags).toBe(0);
    expect(padded[0]?.pcm[0]).toBe(5);
    expect(padded[0]?.pcm[1599]).toBe(0);
    const next = a.push(new Int16Array(1600));
    expect(next[0]?.tsMs).toBe(600);
    expect(next[0]?.flags).toBe(FLAG_DISCONTINUITY);
  });

  it('clamps huge gaps so tsMs stays a safe uint32', () => {
    const a = new FrameAssembler();
    a.markGap(1e300);
    const [b] = a.push(new Int16Array(1600));
    expect(b?.tsMs).toBeLessThanOrEqual(86_400_000);
    expect(b?.tsMs).toBeGreaterThan(0);
  });
});
