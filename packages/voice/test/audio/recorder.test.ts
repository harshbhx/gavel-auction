import * as fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  AudioRingBuffer,
  OptInRecorder,
  RecorderRefusedError,
  SAMPLE_RATE,
} from '../../src/audio/recorder.js';
import { AudioQueue } from '../../src/audio/queue.js';
import { FRAME_SAMPLES, type AudioBatch } from '../../src/audio/frame.js';

vi.mock('node:fs', () => ({
  writeFileSync: vi.fn(),
  writeFile: vi.fn(),
  appendFileSync: vi.fn(),
  createWriteStream: vi.fn(),
  promises: { writeFile: vi.fn(), appendFile: vi.fn() },
}));

function recorder(
  env: Record<string, string | undefined>,
  outDir = 'C:/fixtures',
): {
  rec: OptInRecorder;
  writes: string[];
  indicator: boolean[];
} {
  const writes: string[] = [];
  const indicator: boolean[] = [];
  const rec = new OptInRecorder({
    env,
    outDir,
    repoRoot: 'E:/repo',
    setIndicator: (on) => indicator.push(on),
    write: (p) => writes.push(p),
    nowMs: () => 1234,
  });
  return { rec, writes, indicator };
}

describe('T-VOX-102 no audio at rest (R-VOX-094)', () => {
  it('a full fake session makes zero fs writes and never holds more than 5 s', () => {
    const ring = new AudioRingBuffer();
    const queue = new AudioQueue();
    let seq = 0;
    for (let i = 0; i < 2000; i++) {
      const pcm = new Int16Array(5 * FRAME_SAMPLES).fill(i % 100);
      ring.push(pcm);
      const b: AudioBatch = { seq: seq++, tsMs: i * 100, flags: 0, pcm };
      queue.push(b);
      expect(ring.durationMs).toBeLessThanOrEqual(5000);
    }
    expect(ring.durationMs).toBe(5000);
    expect(ring.snapshot().length).toBe(5 * SAMPLE_RATE);
    expect(vi.mocked(fs.writeFileSync)).not.toHaveBeenCalled();
    expect(vi.mocked(fs.writeFile)).not.toHaveBeenCalled();
    expect(vi.mocked(fs.appendFileSync)).not.toHaveBeenCalled();
    expect(vi.mocked(fs.createWriteStream)).not.toHaveBeenCalled();
    expect(vi.mocked(fs.promises.writeFile)).not.toHaveBeenCalled();
  });

  it('ring keeps the newest samples in order and clamps capacity to 5 s', () => {
    const ring = new AudioRingBuffer(60000);
    ring.push(Int16Array.from([1, 2, 3]));
    expect(Array.from(ring.snapshot())).toEqual([1, 2, 3]);
    const small = new AudioRingBuffer(1);
    small.push(Int16Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]));
    expect(Array.from(small.snapshot())).toEqual([
      3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
    ]);
    ring.clear();
    expect(ring.durationMs).toBe(0);
  });

  it('refuses when VOICE_RECORD is unset or not 1', () => {
    for (const env of [{}, { VOICE_RECORD: '0' }, { VOICE_RECORD: 'true' }]) {
      const { rec, indicator } = recorder(env);
      expect(() => rec.start()).toThrow(RecorderRefusedError);
      expect(rec.recording).toBe(false);
      expect(indicator).toEqual([]);
    }
  });

  it('refuses a path inside the repo', () => {
    const { rec } = recorder({ VOICE_RECORD: '1' }, 'E:\\repo\\fixtures');
    expect(() => rec.start()).toThrow(RecorderRefusedError);
  });

  it('records with the indicator on and writes one wav outside the repo', () => {
    const { rec, writes, indicator } = recorder({ VOICE_RECORD: '1' });
    rec.start();
    rec.push(Int16Array.from([1, 2, 3]));
    const path = rec.stop('take 1');
    expect(indicator).toEqual([true, false]);
    expect(writes).toEqual(['C:/fixtures/take_1-1234.wav']);
    expect(path).toBe(writes[0]);
    expect(rec.recording).toBe(false);
  });

  it('refuses push or stop before start', () => {
    const { rec } = recorder({ VOICE_RECORD: '1' });
    expect(() => rec.push(new Int16Array(1))).toThrow(RecorderRefusedError);
    expect(() => rec.stop('x')).toThrow(RecorderRefusedError);
  });
});
