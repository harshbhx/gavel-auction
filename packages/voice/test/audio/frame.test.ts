import { describe, expect, it } from 'vitest';
import {
  FRAME_BYTES,
  FRAME_SAMPLES,
  HEADER_BYTES,
  FLAG_DISCONTINUITY,
  FLAG_KEEPALIVE,
  VoiceFrameError,
  decodeBatch,
  encodeBatch,
} from '../../src/audio/frame.js';

// Small deterministic PRNG so the test is reproducible.
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof VoiceFrameError ? e.code : 'other';
  }
  return undefined;
}

describe('T-VOX-005 frame codec', () => {
  it('has the spec constants', () => {
    expect([FRAME_SAMPLES, FRAME_BYTES, HEADER_BYTES]).toEqual([320, 640, 12]);
  });

  it('round trips 1..10 frames', () => {
    const r = rng(7);
    for (let n = 1; n <= 10; n++) {
      const pcm = new Int16Array(n * FRAME_SAMPLES);
      for (let i = 0; i < pcm.length; i++) pcm[i] = Math.floor(r() * 65536) - 32768;
      const batch = {
        seq: Math.floor(r() * 4294967296),
        tsMs: Math.floor(r() * 4294967296),
        flags: n % 2 ? FLAG_DISCONTINUITY : 0,
        pcm,
      };
      const bytes = encodeBatch(batch);
      expect(bytes.length).toBe(HEADER_BYTES + n * FRAME_BYTES);
      const back = decodeBatch(bytes);
      expect(back.seq).toBe(batch.seq);
      expect(back.tsMs).toBe(batch.tsMs);
      expect(back.flags).toBe(batch.flags);
      expect(Array.from(back.pcm)).toEqual(Array.from(pcm));
    }
  });

  it('decodes a view with a nonzero byteOffset', () => {
    const bytes = encodeBatch({
      seq: 3,
      tsMs: 100,
      flags: 0,
      pcm: new Int16Array(FRAME_SAMPLES).fill(-5),
    });
    const padded = new Uint8Array(bytes.length + 3);
    padded.set(bytes, 3);
    expect(decodeBatch(padded.subarray(3)).pcm[0]).toBe(-5);
  });

  it('rejects bad length', () => {
    const ok = encodeBatch({ seq: 0, tsMs: 0, flags: 0, pcm: new Int16Array(FRAME_SAMPLES) });
    const odd = new Uint8Array(ok.length + 1);
    odd.set(ok);
    expect(codeOf(() => decodeBatch(odd))).toBe('bad_length');
    expect(codeOf(() => decodeBatch(ok.subarray(0, HEADER_BYTES)))).toBe('bad_length'); // 0 frames
    expect(codeOf(() => decodeBatch(ok.subarray(0, 5)))).toBe('bad_length');
    expect(
      codeOf(() =>
        encodeBatch({ seq: 0, tsMs: 0, flags: 0, pcm: new Int16Array(11 * FRAME_SAMPLES) }),
      ),
    ).toBe('bad_length');
    expect(codeOf(() => encodeBatch({ seq: 0, tsMs: 0, flags: 0, pcm: new Int16Array(0) }))).toBe(
      'bad_length',
    );
  });

  it('rejects bad magic and version', () => {
    const ok = encodeBatch({ seq: 0, tsMs: 0, flags: 0, pcm: new Int16Array(FRAME_SAMPLES) });
    const magic = ok.slice();
    magic[0] = 0x57;
    expect(codeOf(() => decodeBatch(magic))).toBe('bad_magic');
    const ver = ok.slice();
    ver[1] = 2;
    expect(codeOf(() => decodeBatch(ver))).toBe('bad_version');
  });

  it('allows payload-free keepalive', () => {
    const bytes = encodeBatch({ seq: 9, tsMs: 500, flags: FLAG_KEEPALIVE, pcm: new Int16Array(0) });
    expect(bytes.length).toBe(HEADER_BYTES);
    expect(decodeBatch(bytes).flags).toBe(FLAG_KEEPALIVE);
  });
});
