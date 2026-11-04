import type { AudioBatch } from './frame.js';
import { FLAG_DISCONTINUITY, FRAME_SAMPLES } from './frame.js';

export const QUEUE_CAPACITY = 50;
export const BUFFERED_AMOUNT_LIMIT = 65536;
const FRAME_MS = 20;

export interface QueueStats {
  length: number;
  droppedBatches: number;
  droppedMs: number;
}

/**
 * Bounded send queue. When full, or when the socket's bufferedAmount is over the limit,
 * the OLDEST batch is dropped and the next batch handed out carries the discontinuity flag.
 */
export class AudioQueue {
  private readonly items: AudioBatch[] = [];
  private droppedBatches = 0;
  private droppedMs = 0;
  private gap = false;

  constructor(
    private readonly capacity: number = QUEUE_CAPACITY,
    private readonly bufferedLimit: number = BUFFERED_AMOUNT_LIMIT,
  ) {}

  private dropOldest(): void {
    const old = this.items.shift();
    if (!old) return;
    this.droppedBatches++;
    this.droppedMs += (old.pcm.length / FRAME_SAMPLES) * FRAME_MS;
    this.gap = true;
  }

  push(b: AudioBatch): void {
    this.items.push(b);
    while (this.items.length > this.capacity) this.dropOldest();
  }

  /**
   * Next batch to send, or null when empty. If bufferedAmount is over the limit the oldest
   * batch is dropped (not sent) and the caller should retry later.
   */
  next(bufferedAmount: number): AudioBatch | null {
    if (this.items.length === 0) return null;
    if (bufferedAmount > this.bufferedLimit) {
      this.dropOldest();
      return null;
    }
    const b = this.items.shift() as AudioBatch;
    if (this.gap) {
      this.gap = false;
      return { ...b, flags: b.flags | FLAG_DISCONTINUITY };
    }
    return b;
  }

  get stats(): QueueStats {
    return {
      length: this.items.length,
      droppedBatches: this.droppedBatches,
      droppedMs: this.droppedMs,
    };
  }
}
