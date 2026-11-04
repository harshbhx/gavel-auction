import { describe, expect, it } from 'vitest';
import { FLAG_DISCONTINUITY, FRAME_SAMPLES, type AudioBatch } from '../../src/audio/frame.js';
import { AudioQueue } from '../../src/audio/queue.js';

function batch(seq: number): AudioBatch {
  return { seq, tsMs: seq * 100, flags: 0, pcm: new Int16Array(5 * FRAME_SAMPLES) };
}

describe('T-VOX-007 drop oldest at capacity', () => {
  it('keeps 50, drops the 30 oldest, flags the next send', () => {
    const q = new AudioQueue();
    for (let i = 0; i < 80; i++) q.push(batch(i));
    expect(q.stats).toEqual({ length: 50, droppedBatches: 30, droppedMs: 3000 });
    const first = q.next(0) as AudioBatch;
    expect(first.seq).toBe(30);
    expect(first.flags & FLAG_DISCONTINUITY).toBe(FLAG_DISCONTINUITY);
    const second = q.next(0) as AudioBatch;
    expect(second.seq).toBe(31);
    expect(second.flags & FLAG_DISCONTINUITY).toBe(0);
  });

  it('returns null when empty and does not flag without drops', () => {
    const q = new AudioQueue();
    expect(q.next(0)).toBeNull();
    q.push(batch(0));
    expect((q.next(0) as AudioBatch).flags).toBe(0);
  });
});

describe('T-VOX-008 back-pressure bound', () => {
  it('stays at most 50 over 10 minutes with a stalled socket', () => {
    const q = new AudioQueue();
    const batches = 10 * 60 * 10; // 10 batches per second
    let max = 0;
    for (let i = 0; i < batches; i++) {
      q.push(batch(i));
      expect(q.next(70000)).toBeNull(); // bufferedAmount over 65536 drops the oldest
      max = Math.max(max, q.stats.length);
    }
    expect(max).toBeLessThanOrEqual(50);
    expect(q.stats.droppedBatches).toBeGreaterThan(0);
    const resumed = q.next(0) as AudioBatch;
    expect(resumed.flags & FLAG_DISCONTINUITY).toBe(FLAG_DISCONTINUITY);
  });
});
