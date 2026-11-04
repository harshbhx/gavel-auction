import type { CancelTimer, Clock, Transport } from '@gavel/shared';

/** R-RT-071: frames a connection may hold before it counts as a slow consumer. */
export const MAX_QUEUED_FRAMES = 256;
/** R-RT-071: how long one write may stay undrained. */
export const DRAIN_TIMEOUT_MS = 5000;
/** Close code for a slow consumer; the client reconnects and resyncs. */
export const SLOW_CONSUMER_CODE = 4008;

/** The raw socket: write one frame and report when it has left, or close. */
export interface FrameSink {
  write(text: string, done: (err?: Error) => void): void;
  close(code: number, reason: string): void;
}

export interface ConnectionOptions {
  clock: Clock;
  sink: FrameSink;
  maxQueued?: number;
  drainTimeoutMs?: number;
  /** Called once when the connection is closed, whatever the cause. */
  onClosed?: (code: number, reason: string) => void;
}

/**
 * One connection's outbound side: a bounded FIFO with one write in flight, so
 * delivery order equals send order (R-RT-072). Overflow or a write that does
 * not finish within the drain timeout closes this connection only.
 */
export class BoundedConnection implements Transport {
  private readonly queue: string[] = [];
  private writing = false;
  private closed = false;
  private cancelDrain: CancelTimer | undefined;
  private readonly maxQueued: number;
  private readonly drainMs: number;

  constructor(private readonly opts: ConnectionOptions) {
    this.maxQueued = opts.maxQueued ?? MAX_QUEUED_FRAMES;
    this.drainMs = opts.drainTimeoutMs ?? DRAIN_TIMEOUT_MS;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** Frames waiting, including the one being written. */
  get pending(): number {
    return this.queue.length + (this.writing ? 1 : 0);
  }

  send(text: string): void {
    if (this.closed) return;
    if (this.pending >= this.maxQueued) {
      this.close(SLOW_CONSUMER_CODE, 'slow_consumer');
      return;
    }
    this.queue.push(text);
    this.pump();
  }

  close(code: number, reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.cancelDrain?.();
    this.cancelDrain = undefined;
    this.queue.length = 0;
    try {
      this.opts.sink.close(code, reason);
    } finally {
      this.opts.onClosed?.(code, reason);
    }
  }

  private pump(): void {
    if (this.writing || this.closed) return;
    const next = this.queue.shift();
    if (next === undefined) return;
    this.writing = true;
    this.cancelDrain = this.opts.clock.setTimer(this.opts.clock.now() + this.drainMs, () => {
      this.close(SLOW_CONSUMER_CODE, 'slow_consumer');
    });
    this.opts.sink.write(next, (err) => {
      if (this.closed) return;
      this.cancelDrain?.();
      this.cancelDrain = undefined;
      this.writing = false;
      if (err !== undefined) {
        this.close(1011, 'write_failed');
        return;
      }
      this.pump();
    });
  }
}
