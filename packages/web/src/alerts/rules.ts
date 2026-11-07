import type { MyStatus } from '../store/selectors';

/** What the phone or the projector should signal. */
export type AlertType = 'outbid' | 'win' | 'sold' | 'hammer';

/**
 * Pure rule for the bidder phone: which alert a change of the bidder's own status raises.
 * The first value seen after joining is never an alert, so a reload stays quiet.
 */
export function alertForStatus(prev: MyStatus, next: MyStatus): AlertType | null {
  if (prev === next || prev === 'watching') return null;
  if (next === 'outbid' || next === 'atCeiling') return prev === 'leading' ? 'outbid' : null;
  if (next === 'won') return 'win';
  if (next === 'lost') return 'sold';
  return null;
}

/** Pure rule for the projector: the hammer message arriving raises one gavel sound. */
export function alertForHammer(hadHammer: boolean, hasHammer: boolean): AlertType | null {
  return !hadHammer && hasHammer ? 'hammer' : null;
}

export interface Tone {
  readonly hz: number;
  /** Start offset from the moment of the alert. */
  readonly atMs: number;
  readonly durMs: number;
  readonly gain: number;
}

/** Soft sine tones, quiet on purpose (peak gain at most 0.2). */
export const TONES: Readonly<Record<AlertType, readonly Tone[]>> = {
  outbid: [
    { hz: 440, atMs: 0, durMs: 140, gain: 0.15 },
    { hz: 330, atMs: 150, durMs: 220, gain: 0.15 },
  ],
  win: [
    { hz: 523, atMs: 0, durMs: 120, gain: 0.16 },
    { hz: 659, atMs: 120, durMs: 120, gain: 0.16 },
    { hz: 784, atMs: 240, durMs: 260, gain: 0.16 },
  ],
  sold: [{ hz: 392, atMs: 0, durMs: 260, gain: 0.12 }],
  hammer: [
    { hz: 180, atMs: 0, durMs: 90, gain: 0.2 },
    { hz: 120, atMs: 0, durMs: 160, gain: 0.2 },
  ],
};

/** Vibration patterns in milliseconds. The projector does not vibrate. */
export const VIBRATION: Readonly<Record<AlertType, readonly number[]>> = {
  outbid: [60],
  win: [40, 50, 40],
  sold: [80],
  hammer: [],
};
