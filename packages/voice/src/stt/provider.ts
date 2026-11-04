import type { AudioBatch } from '../audio/frame.js';

/** Seconds from stream start. */
export interface SttWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
}

export type SttErrorCode = 'timeout' | 'closed' | 'auth' | 'rate_limited' | 'bad_audio' | 'unknown';
export type SttState = 'connecting' | 'open' | 'reconnecting' | 'closed';

export type SttEvent =
  | { type: 'interim'; text: string; startMs: number }
  | {
      type: 'final';
      text: string;
      words: SttWord[];
      startMs: number;
      endMs: number;
      confidence: number;
      speechFinal: boolean;
    }
  | { type: 'utterance_end'; atMs: number }
  | { type: 'error'; code: SttErrorCode; retryable: boolean }
  | { type: 'state'; state: SttState };

export interface SttProvider {
  readonly name: 'deepgram' | 'groq' | 'webspeech' | 'fake' | 'replay';
  start(opts: { keyterms: string[]; language: 'en' }): Promise<void>;
  /** Never blocks and never throws; on overload a batch is dropped and a discontinuity is recorded. */
  write(batch: AudioBatch): void;
  events(): AsyncIterable<SttEvent>;
  /** Flushes and resolves after the 'closed' state event. */
  stop(): Promise<void>;
}

export interface SttCounters {
  bytesIn: number;
  finals: number;
  interims: number;
  errors: number;
  reconnects: number;
  droppedBatches: number;
}

export const DEFAULT_LATENCY_BOUNDS_MS: readonly number[] = [100, 250, 500, 1000, 2000, 4000];

/** Fixed-bucket histogram of milliseconds. The last bucket (Infinity) catches everything above the bounds. */
export class LatencyHistogram {
  private readonly bounds: number[];
  private readonly buckets: number[];
  private n = 0;
  private total = 0;
  private maxSeen = 0;

  constructor(bounds: readonly number[] = DEFAULT_LATENCY_BOUNDS_MS) {
    this.bounds = [...bounds].sort((a, b) => a - b);
    this.buckets = new Array<number>(this.bounds.length + 1).fill(0);
  }

  record(ms: number): void {
    const v = Math.max(0, ms);
    let i = this.bounds.findIndex((b) => v <= b);
    if (i < 0) i = this.bounds.length;
    this.buckets[i] = (this.buckets[i] ?? 0) + 1;
    this.n += 1;
    this.total += v;
    if (v > this.maxSeen) this.maxSeen = v;
  }

  get count(): number {
    return this.n;
  }

  get mean(): number {
    return this.n === 0 ? 0 : this.total / this.n;
  }

  get max(): number {
    return this.maxSeen;
  }

  /** Upper bound of the bucket holding the p-th percentile (0..1); the max seen for the overflow bucket. */
  percentile(p: number): number {
    if (this.n === 0) return 0;
    const target = Math.max(1, Math.ceil(p * this.n));
    let seen = 0;
    for (let i = 0; i < this.buckets.length; i++) {
      seen += this.buckets[i] ?? 0;
      if (seen >= target) return i < this.bounds.length ? (this.bounds[i] ?? 0) : this.maxSeen;
    }
    return this.maxSeen;
  }

  snapshot(): Array<{ le: number; count: number }> {
    return this.buckets.map((count, i) => ({
      le: i < this.bounds.length ? (this.bounds[i] ?? 0) : Number.POSITIVE_INFINITY,
      count,
    }));
  }
}

/** Counters and the speech-end-to-final latency histogram every provider exposes (R-VOX-026). */
export class SttStats {
  readonly counters: SttCounters = {
    bytesIn: 0,
    finals: 0,
    interims: 0,
    errors: 0,
    reconnects: 0,
    droppedBatches: 0,
  };
  readonly latency = new LatencyHistogram();

  addBytes(n: number): void {
    this.counters.bytesIn += n;
  }

  addDropped(n = 1): void {
    this.counters.droppedBatches += n;
  }

  /** Count an outgoing event. For finals, `latencyMs` is speech end to delivery. */
  observe(event: SttEvent, latencyMs?: number): void {
    switch (event.type) {
      case 'interim':
        this.counters.interims += 1;
        break;
      case 'final':
        this.counters.finals += 1;
        if (latencyMs !== undefined) this.latency.record(latencyMs);
        break;
      case 'error':
        this.counters.errors += 1;
        break;
      case 'state':
        if (event.state === 'reconnecting') this.counters.reconnects += 1;
        break;
      case 'utterance_end':
        break;
    }
  }
}

export interface InstrumentedSttProvider extends SttProvider {
  readonly stats: SttStats;
}

/**
 * Bounded single-consumer async queue. When full, the oldest interim is dropped first,
 * otherwise the oldest item, so a slow consumer can never grow memory without limit.
 */
export class EventChannel<T extends { type: string }> {
  private readonly items: T[] = [];
  private waiting: Array<(r: IteratorResult<T>) => void> = [];
  private closed = false;
  dropped = 0;

  constructor(private readonly capacity = 1024) {}

  push(item: T): void {
    if (this.closed) return;
    const w = this.waiting.shift();
    if (w) {
      w({ value: item, done: false });
      return;
    }
    if (this.items.length >= this.capacity) {
      const i = this.items.findIndex((x) => x.type === 'interim');
      this.items.splice(i >= 0 ? i : 0, 1);
      this.dropped += 1;
    }
    this.items.push(item);
  }

  close(): void {
    this.closed = true;
    for (const w of this.waiting) w({ value: undefined, done: true });
    this.waiting = [];
  }

  get size(): number {
    return this.items.length;
  }

  iterable(): AsyncIterable<T> {
    return {
      [Symbol.asyncIterator]: (): AsyncIterator<T> => ({
        next: (): Promise<IteratorResult<T>> => {
          const v = this.items.shift();
          if (v !== undefined) return Promise.resolve({ value: v, done: false });
          if (this.closed) return Promise.resolve({ value: undefined, done: true });
          return new Promise((resolve) => this.waiting.push(resolve));
        },
      }),
    };
  }
}
