import type { EnginePort, EpochMs } from '@gavel/shared';

/**
 * An engine that can freeze and restore the lot clock (R-RT-049). The room appends the control
 * record; the engine keeps the time left, so resume moves `endTs` by the paused duration.
 */
export interface PauseEnginePort extends EnginePort {
  /** Freezes the clock. Throws when the lot is not open or already paused. */
  pause(now: EpochMs): void;
  /** Sets `endTs` to `now` plus the time left at pause. Throws when the lot is not paused. */
  resume(now: EpochMs): void;
  /** True between pause and resume; bids are rejected `auction_paused` meanwhile. */
  isPaused(): boolean;
}

export function canPause(engine: EnginePort): engine is PauseEnginePort {
  const e = engine as Partial<PauseEnginePort>;
  return (
    typeof e.pause === 'function' &&
    typeof e.resume === 'function' &&
    typeof e.isPaused === 'function'
  );
}

/** True when the engine supports pause and is paused right now. */
export function isPausedEngine(engine: EnginePort | undefined): boolean {
  return engine !== undefined && canPause(engine) && engine.isPaused();
}
