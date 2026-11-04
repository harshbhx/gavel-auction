import { FLAG_DISCONTINUITY, FRAME_SAMPLES, type AudioBatch } from './frame.js';

export const FRAMES_PER_BATCH = 5;
const FRAME_MS = 20;

/**
 * Turns Int16 chunks of any size into numbered batches of 5 frames (100 ms).
 * seq increases by 1 per message; tsMs is 20 ms times the frames emitted so far, plus any
 * explicitly marked gap. Remainders carry across calls.
 */
export class FrameAssembler {
  private readonly batchSamples = FRAME_SAMPLES * FRAMES_PER_BATCH;
  private readonly pending = new Int16Array(this.batchSamples);
  private filled = 0;
  private seq = 0;
  private framesSent = 0;
  private gapMs = 0;
  private gapFlag = false;

  push(samples: Int16Array): AudioBatch[] {
    const out: AudioBatch[] = [];
    let i = 0;
    while (i < samples.length) {
      const take = Math.min(this.batchSamples - this.filled, samples.length - i);
      this.pending.set(samples.subarray(i, i + take), this.filled);
      this.filled += take;
      i += take;
      if (this.filled === this.batchSamples) {
        out.push({
          seq: this.seq++,
          tsMs: this.framesSent * FRAME_MS + this.gapMs,
          flags: this.gapFlag ? FLAG_DISCONTINUITY : 0,
          pcm: this.pending.slice(),
        });
        this.gapFlag = false;
        this.framesSent += FRAMES_PER_BATCH;
        this.filled = 0;
      }
    }
    return out;
  }

  /** Mark `ms` of missing audio: later timestamps shift by it and the next batch is flagged. */
  markGap(ms: number): void {
    if (ms <= 0) return;
    this.gapMs += Math.round(ms);
    this.gapFlag = true;
  }

  /** Samples held back waiting for a full batch. */
  get buffered(): number {
    return this.filled;
  }
}
