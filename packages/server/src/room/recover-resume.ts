import type { CancelTimer, Clock } from '@gavel/shared';

/** How often the host re-runs recovery after start-up. */
export const RESUME_INTERVAL_MS = 30_000;

export interface RecoveryOptions {
  clock: Clock;
  /** The auction service: `resume` loads rooms (re-arming timers) and continues settlements. */
  service: { resume(): Promise<void> };
  intervalMs?: number;
  /** Called when a pass fails; the loop keeps going. */
  onError?: (err: unknown) => void;
}

export interface RecoveryLoop {
  /** Resolves when the first pass has finished. */
  started: Promise<void>;
  stop(): void;
}

/**
 * Runs `service.resume()` once now and then on a timer (R-RT-060). Passes never
 * overlap: the next one is scheduled only after the previous one ends.
 */
export function startRecovery(opts: RecoveryOptions): RecoveryLoop {
  const interval = opts.intervalMs ?? RESUME_INTERVAL_MS;
  let stopped = false;
  let cancel: CancelTimer | undefined;

  const pass = async (): Promise<void> => {
    try {
      await opts.service.resume();
    } catch (err) {
      opts.onError?.(err);
    }
    if (stopped) return;
    cancel = opts.clock.setTimer(opts.clock.now() + interval, () => {
      void pass();
    });
  };

  return {
    started: pass(),
    stop: () => {
      stopped = true;
      cancel?.();
      cancel = undefined;
    },
  };
}
