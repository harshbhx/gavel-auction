import { describe, expect, it } from 'vitest';
import {
  BATCH_SAMPLES,
  Batcher,
  FLAG_END_OF_UTTERANCE,
  FLAG_KEEPALIVE,
  HEADER_BYTES,
  encodeBatch,
} from '../../src/audio/frame';

describe('audio message encoder', () => {
  it('writes the header and little endian samples the host expects', () => {
    const pcm = new Int16Array(BATCH_SAMPLES);
    pcm[0] = 1;
    pcm[1] = -2;
    const bytes = encodeBatch({ seq: 258, tsMs: 100, flags: 1, pcm });
    expect(bytes.length).toBe(HEADER_BYTES + BATCH_SAMPLES * 2);
    expect(Array.from(bytes.slice(0, 12))).toEqual([0x56, 1, 1, 0, 2, 1, 0, 0, 100, 0, 0, 0]);
    expect(Array.from(bytes.slice(12, 16))).toEqual([1, 0, 0xfe, 0xff]);
  });

  it('writes a keepalive with no audio and refuses audio inside one', () => {
    const bytes = encodeBatch({
      seq: 7,
      tsMs: 5000,
      flags: FLAG_KEEPALIVE | FLAG_END_OF_UTTERANCE,
      pcm: new Int16Array(0),
    });
    expect(bytes.length).toBe(HEADER_BYTES);
    expect(bytes[2]).toBe(10);
    expect(() =>
      encodeBatch({ seq: 0, tsMs: 0, flags: FLAG_KEEPALIVE, pcm: new Int16Array(320) }),
    ).toThrow();
  });

  it('refuses audio that is not 1 to 10 whole frames', () => {
    expect(() => encodeBatch({ seq: 0, tsMs: 0, flags: 0, pcm: new Int16Array(100) })).toThrow();
    expect(() => encodeBatch({ seq: 0, tsMs: 0, flags: 0, pcm: new Int16Array(0) })).toThrow();
    expect(() => encodeBatch({ seq: 0, tsMs: 0, flags: 0, pcm: new Int16Array(3520) })).toThrow();
    expect(() =>
      encodeBatch({ seq: 0, tsMs: 0, flags: 0, pcm: new Int16Array(320) }),
    ).not.toThrow();
  });

  it('wraps seq and time to 32 bits', () => {
    const bytes = encodeBatch({
      seq: 2 ** 32 + 3,
      tsMs: 2 ** 32 + 4,
      flags: 0,
      pcm: new Int16Array(320),
    });
    expect(Array.from(bytes.slice(4, 12))).toEqual([3, 0, 0, 0, 4, 0, 0, 0]);
  });
});

describe('batcher', () => {
  it('cuts chunks of any size into whole batches and keeps the rest', () => {
    const b = new Batcher();
    expect(b.push(new Int16Array(1000))).toHaveLength(0);
    const out = b.push(new Int16Array(1000));
    expect(out).toHaveLength(1);
    expect(out[0]?.length).toBe(BATCH_SAMPLES);
    expect(b.buffered).toBe(400);
  });

  it('keeps sample order across calls', () => {
    const b = new Batcher();
    const a = Int16Array.from({ length: BATCH_SAMPLES + 5 }, (_, i) => i);
    const [first] = b.push(a);
    expect(first?.[BATCH_SAMPLES - 1]).toBe(BATCH_SAMPLES - 1);
    const rest = b.flush();
    expect(rest?.[0]).toBe(BATCH_SAMPLES);
    expect(rest?.[4]).toBe(BATCH_SAMPLES + 4);
  });

  it('pads the held part with silence on flush and has nothing to flush when empty', () => {
    const b = new Batcher();
    expect(b.flush()).toBeNull();
    b.push(Int16Array.from([5, 6, 7]));
    const rest = b.flush();
    expect(rest?.length).toBe(BATCH_SAMPLES);
    expect(Array.from(rest?.slice(0, 4) ?? [])).toEqual([5, 6, 7, 0]);
    expect(b.flush()).toBeNull();
  });

  it('drops the held part on reset', () => {
    const b = new Batcher();
    b.push(new Int16Array(10));
    b.reset();
    expect(b.buffered).toBe(0);
  });
});
