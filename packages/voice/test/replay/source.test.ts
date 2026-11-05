import { describe, expect, it } from 'vitest';
import { FLAG_END_OF_STREAM, FRAME_SAMPLES, type AudioBatch } from '../../src/audio/frame.js';
import { encodeWav } from '../../src/audio/wav.js';
import { FakeStt, VirtualClock } from '../../src/stt/fake.js';
import { ReplaySource, WavError, readWav } from '../../src/replay/source.js';

function tenSecondWav(): Uint8Array {
  const pcm = new Int16Array(160000);
  for (let i = 0; i < pcm.length; i++) pcm[i] = (i % 100) - 50;
  return encodeWav(pcm);
}

async function replay(speed: 1 | 4): Promise<{ batches: AudioBatch[]; finishedAt: number }> {
  const clock = new VirtualClock();
  const stt = new FakeStt({ clock });
  await stt.start({ keyterms: [], language: 'en' });
  const src = new ReplaySource({ wav: tenSecondWav(), clock, speed });
  const batches: AudioBatch[] = [];
  let finishedAt = -1;
  const p = src.start((b) => {
    batches.push(b);
    stt.write(b);
    if ((b.flags & FLAG_END_OF_STREAM) !== 0) finishedAt = clock.now();
  });
  clock.advance(10000);
  await p;
  return { batches, finishedAt };
}

describe('T-VOX-089 replay source', () => {
  it('feeds a 10 s fixture at 1x and 4x with equal frames and monotonic timestamps', async () => {
    const one = await replay(1);
    const four = await replay(4);
    const frames = (bs: AudioBatch[]): number =>
      bs.reduce((n, b) => n + b.pcm.length / FRAME_SAMPLES, 0);
    expect(frames(one.batches)).toBe(500);
    expect(frames(four.batches)).toBe(500);
    for (const run of [one, four]) {
      for (let i = 1; i < run.batches.length; i++) {
        expect(run.batches[i]?.tsMs ?? 0).toBeGreaterThan(run.batches[i - 1]?.tsMs ?? 0);
      }
      expect((run.batches[run.batches.length - 1]?.flags ?? 0) & FLAG_END_OF_STREAM).not.toBe(0);
    }
    expect(one.finishedAt).toBe(10000);
    expect(four.finishedAt).toBe(2500);
  });

  it('delivers the audio samples unchanged and pads the final frame', async () => {
    const clock = new VirtualClock();
    const pcm = new Int16Array(FRAME_SAMPLES + 10).fill(7);
    const src = new ReplaySource({ wav: encodeWav(pcm), clock });
    const got: AudioBatch[] = [];
    const p = src.start((b) => got.push(b));
    clock.advance(1000);
    await p;
    expect(got).toHaveLength(1);
    expect(got[0]?.pcm.length).toBe(2 * FRAME_SAMPLES);
    expect(got[0]?.pcm[FRAME_SAMPLES + 9]).toBe(7);
    expect(got[0]?.pcm[FRAME_SAMPLES + 10]).toBe(0);
  });

  it('stop ends the stream early', async () => {
    const clock = new VirtualClock();
    const src = new ReplaySource({ wav: tenSecondWav(), clock });
    const got: AudioBatch[] = [];
    const p = src.start((b) => got.push(b));
    clock.advance(500);
    src.stop();
    await p;
    clock.advance(10000);
    expect(got).toHaveLength(5);
  });
});

describe('readWav', () => {
  it('round-trips encodeWav output', () => {
    const pcm = Int16Array.from([1, -2, 300, -32768, 32767]);
    expect(Array.from(readWav(encodeWav(pcm)))).toEqual(Array.from(pcm));
  });

  it('rejects other formats and junk', () => {
    expect(() => readWav(new Uint8Array(10))).toThrow(WavError);
    const wav = encodeWav(new Int16Array(4));
    new DataView(wav.buffer).setUint32(24, 44100, true);
    expect(() => readWav(wav)).toThrow(/16 kHz/);
  });
});
