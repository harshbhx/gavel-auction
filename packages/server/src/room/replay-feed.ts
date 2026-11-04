import type { CancelTimer, Clock } from '@gavel/shared';

/** Slowest and fastest replay speeds (R-RT-108). */
export const MIN_REPLAY_SPEED = 1;
export const MAX_REPLAY_SPEED = 16;

/** Anything with a log position and a time can be replayed. */
export interface Replayable {
  seq: number;
  ts: number;
}

export interface ReplayFeedOptions<E extends Replayable> {
  events: readonly E[];
  clock: Clock;
  /** 1 to 16; the gap between two events is the original gap divided by this. */
  speed: number;
  emit: (event: E) => void;
  /** Called once after the last event has been emitted. */
  onEnd?: () => void;
}

/**
 * Re-emits a stored log through a Clock for the web replay mode. The first event
 * goes out at once; each later event goes out after the original delta from the
 * first, divided by the speed. Nothing is read from a wall clock.
 */
export class ReplayFeed<E extends Replayable> {
  private next = 0;
  private startedAt = 0;
  private cancel: CancelTimer | undefined;
  private running = false;

  constructor(private readonly opts: ReplayFeedOptions<E>) {
    const { speed } = opts;
    if (!Number.isFinite(speed) || speed < MIN_REPLAY_SPEED || speed > MAX_REPLAY_SPEED) {
      throw new RangeError(`speed must be between ${MIN_REPLAY_SPEED} and ${MAX_REPLAY_SPEED}`);
    }
  }

  get emitted(): number {
    return this.next;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.startedAt = this.opts.clock.now();
    this.pump();
  }

  stop(): void {
    this.running = false;
    this.cancel?.();
    this.cancel = undefined;
  }

  private dueAt(index: number): number {
    const { events, speed } = this.opts;
    const first = events[0];
    const event = events[index];
    if (first === undefined || event === undefined) return this.startedAt;
    return this.startedAt + Math.round((event.ts - first.ts) / speed);
  }

  private pump(): void {
    this.cancel = undefined;
    const { events, clock } = this.opts;
    while (this.running && this.next < events.length && this.dueAt(this.next) <= clock.now()) {
      const event = events[this.next];
      this.next += 1;
      if (event !== undefined) this.opts.emit(event);
    }
    if (!this.running) return;
    if (this.next >= events.length) {
      this.running = false;
      this.opts.onEnd?.();
      return;
    }
    this.cancel = clock.setTimer(this.dueAt(this.next), () => this.pump());
  }
}
