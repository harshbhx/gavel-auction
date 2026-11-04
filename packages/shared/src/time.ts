declare const epochBrand: unique symbol;

/** Integer milliseconds since the Unix epoch. */
export type EpochMs = number & { readonly [epochBrand]: 'EpochMs' };

export function EpochMs(value: number): EpochMs {
  if (!Number.isInteger(value)) {
    throw new RangeError('EpochMs must be an integer');
  }
  return value as EpochMs;
}

/** Cancels a pending timer. Calling it more than once is harmless. */
export type CancelTimer = () => void;

export interface Clock {
  now(): EpochMs;
  /** Run `fn` once the clock reaches `atMs`. Returns a function that cancels it. */
  setTimer(atMs: number, fn: () => void): CancelTimer;
}

/** Largest delay setTimeout accepts. */
export const MAX_TIMEOUT_MS = 2_147_483_647;

/** The only place Date.now is read in this package. */
export class SystemClock implements Clock {
  now(): EpochMs {
    return EpochMs(Date.now());
  }

  setTimer(atMs: number, fn: () => void): CancelTimer {
    let handle: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    // Node caps a delay at 2^31-1 ms and may fire a millisecond early, so
    // re-arm until the wall clock has really reached `atMs`.
    const arm = (): void => {
      const delay = Math.min(Math.max(0, atMs - Date.now()), MAX_TIMEOUT_MS);
      handle = setTimeout(() => {
        handle = undefined;
        if (cancelled) return;
        if (Date.now() < atMs) arm();
        else fn();
      }, delay);
    };
    arm();
    return () => {
      cancelled = true;
      if (handle !== undefined) clearTimeout(handle);
    };
  }
}

interface PendingTimer {
  readonly at: number;
  readonly order: number;
  readonly fn: () => void;
}

/** Deterministic clock for tests. Timers fire only when time is advanced. */
export class ManualClock implements Clock {
  private current: number;
  private nextOrder = 0;
  private readonly timers = new Set<PendingTimer>();

  constructor(start: number = 0) {
    this.current = EpochMs(start);
  }

  now(): EpochMs {
    return EpochMs(this.current);
  }

  /**
   * Move to a time. Moving forward fires due timers exactly like `advanceTo`;
   * moving backwards only rewinds, since nothing can fire in the past.
   */
  set(value: number): void {
    const target = EpochMs(value);
    if (target >= this.current) this.advanceTo(target);
    else this.current = target;
  }

  setTimer(atMs: number, fn: () => void): CancelTimer {
    const timer: PendingTimer = { at: EpochMs(atMs), order: this.nextOrder++, fn };
    this.timers.add(timer);
    return () => {
      this.timers.delete(timer);
    };
  }

  /**
   * Move time forward to `t`, firing due timers in (time, registration) order.
   * Each callback sees `now()` equal to its due time (never earlier than the
   * time it was registered at). Timers registered by callbacks that fall due
   * on or before `t` fire in the same call.
   */
  advanceTo(t: number): void {
    const target = EpochMs(t);
    if (target < this.current) {
      throw new RangeError('cannot move the clock backwards');
    }
    for (;;) {
      let next: PendingTimer | undefined;
      for (const timer of this.timers) {
        if (timer.at > target) continue;
        if (!next || timer.at < next.at || (timer.at === next.at && timer.order < next.order)) {
          next = timer;
        }
      }
      if (!next) break;
      this.timers.delete(next);
      this.current = Math.max(this.current, next.at);
      next.fn();
    }
    this.current = target;
  }

  advance(ms: number): void {
    this.advanceTo(this.current + ms);
  }
}
