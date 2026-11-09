import type { CopyKey } from '../../copy/en';

/** How long one beat stays up at 1x, in virtual milliseconds. Speeds divide the real wait. */
export const BEAT_MS = 2400;

/** Playback speeds the viewer can pick; 1x is the default. */
export const SPEEDS = [1, 1.25, 1.5, 2] as const;
export type PlaybackSpeed = (typeof SPEEDS)[number];
export const DEFAULT_SPEED: PlaybackSpeed = 1;

/** Copy key of a speed's visible label and of its full spoken name. */
export const SPEED_LABEL: Readonly<Record<PlaybackSpeed, CopyKey>> = {
  1: 'scriptedDemo.speed1',
  1.25: 'scriptedDemo.speed125',
  1.5: 'scriptedDemo.speed15',
  2: 'scriptedDemo.speed2',
};

const SPEED_STORE_KEY = 'gavel.scripted.speed';

/** The speed kept for this tab, or 1x when none is stored or storage is blocked. */
export function readStoredSpeed(): PlaybackSpeed {
  try {
    const raw = Number(sessionStorage.getItem(SPEED_STORE_KEY));
    return SPEEDS.find((s) => s === raw) ?? DEFAULT_SPEED;
  } catch {
    return DEFAULT_SPEED;
  }
}

export function storeSpeed(speed: PlaybackSpeed): void {
  try {
    sessionStorage.setItem(SPEED_STORE_KEY, String(speed));
  } catch {
    /* storage blocked: the choice just does not outlive this render */
  }
}

export interface Beat {
  /** Scenario time (ms) the beat plays up to. Matches the frames of the `happy` scenario. */
  readonly at: number;
  readonly stage: 'hold' | 'bid' | 'outbid' | 'hammer' | 'capture' | 'receipt';
  readonly label: CopyKey;
  readonly body: CopyKey;
}

/**
 * The beats of the `happy` scenario, one per group of frames: holds, five bids, hammer, and the
 * three settlement frames. The player moves from one beat to the next on one virtual clock, so a
 * viewer reads one change at a time instead of watching the whole script run in 18 seconds.
 */
export const BEATS: readonly Beat[] = [
  { at: 0, stage: 'hold', label: 'scriptedDemo.b0.label', body: 'scriptedDemo.b0.body' },
  { at: 1_000, stage: 'bid', label: 'scriptedDemo.b1.label', body: 'scriptedDemo.b1.body' },
  { at: 2_000, stage: 'outbid', label: 'scriptedDemo.b2.label', body: 'scriptedDemo.b2.body' },
  { at: 3_000, stage: 'outbid', label: 'scriptedDemo.b3.label', body: 'scriptedDemo.b3.body' },
  { at: 4_000, stage: 'outbid', label: 'scriptedDemo.b4.label', body: 'scriptedDemo.b4.body' },
  { at: 5_000, stage: 'outbid', label: 'scriptedDemo.b5.label', body: 'scriptedDemo.b5.body' },
  { at: 15_000, stage: 'hammer', label: 'scriptedDemo.b6.label', body: 'scriptedDemo.b6.body' },
  { at: 16_000, stage: 'hammer', label: 'scriptedDemo.b7.label', body: 'scriptedDemo.b7.body' },
  { at: 17_000, stage: 'capture', label: 'scriptedDemo.b8.label', body: 'scriptedDemo.b8.body' },
  { at: 18_000, stage: 'receipt', label: 'scriptedDemo.b9.label', body: 'scriptedDemo.b9.body' },
];
