import type { QueueStats } from '../audio/queue.js';
import type { CaptureEvent } from './capture-state.js';

export const DEGRADED_WINDOW_MS = 10000;
export const DEGRADED_DROP_MS = 2000;

interface Sample {
  atMs: number;
  droppedMs: number;
}

/**
 * Sliding window over the cumulative queue stats. More than 2000 ms dropped within 10 s
 * yields queue_drop; 10 s without a new drop yields recovered. The caller feeds the events
 * into the capture state reducer, so out-of-state events are harmless.
 */
export class DropMonitor {
  private samples: Sample[] = [];
  private lastDropAtMs: number | null = null;
  private lastTotal = 0;
  private degraded = false;

  constructor(
    private readonly windowMs: number = DEGRADED_WINDOW_MS,
    private readonly thresholdMs: number = DEGRADED_DROP_MS,
  ) {}

  record(stats: QueueStats, nowMs: number): CaptureEvent | null {
    if (stats.droppedMs > this.lastTotal) this.lastDropAtMs = nowMs;
    this.lastTotal = stats.droppedMs;
    this.samples.push({ atMs: nowMs, droppedMs: stats.droppedMs });

    const cutoff = nowMs - this.windowMs;
    // Keep one baseline sample at or before the cutoff so the window delta is exact.
    while (this.samples.length > 1 && (this.samples[1]?.atMs ?? 0) <= cutoff) this.samples.shift();
    const baseline = this.samples[0]?.droppedMs ?? 0;
    const inWindow = stats.droppedMs - baseline;

    if (!this.degraded && inWindow > this.thresholdMs) {
      this.degraded = true;
      return { type: 'queue_drop' };
    }
    if (this.degraded && this.lastDropAtMs !== null && nowMs - this.lastDropAtMs >= this.windowMs) {
      this.degraded = false;
      return { type: 'recovered' };
    }
    return null;
  }
}
