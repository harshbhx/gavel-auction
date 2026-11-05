import type { Journal } from '../types.js';

/**
 * Unknown capture outcome (SPEC 3.5; R-PAY-054, R-PAY-055).
 *
 * A capture whose outcome is unknown (timeout, 5xx, 429 after retries) is never
 * answered with the next candidate. The settlement stays CAPTURING with
 * `unknownSince` set and the runner reports `pending`. A resume reads the hold's
 * truth first: a capture that took effect is adopted, otherwise the saved intent
 * is sent again with the same request id. Once the outcome has stayed unknown
 * longer than the deadline the settlement goes to FAILED_NEEDS_REVIEW, with no
 * fallback. A capture PayPal lists as PENDING waits under its own, longer deadline
 * (R12-P01), and the clock stands still while the kill switch is engaged (R12-P05).
 * The void phase then releases the holds that are provably not
 * captured and not fallback candidates; the hold of the capture in doubt and the holds
 * of the next candidates stay until the review is resolved, is a day old, or an
 * operator releases them (R8-P06, R9-M04).
 */

/** R-PAY-055 default: ten minutes. */
export const DEFAULT_UNKNOWN_DEADLINE_MS = 600_000;

/**
 * R12-P01: how long a capture PayPal has taken but lists as PENDING is waited for, three
 * days. The ten-minute deadline above is for a lost answer; a PENDING capture is PayPal
 * deciding, which can take hours (for example `status_details.reason` PENDING_REVIEW).
 * UNVERIFIED (A16): how long PayPal keeps a capture PENDING. Waiting is the safe side: the
 * capture is never sent again under a new request id and every candidate keeps its hold.
 */
export const DEFAULT_PENDING_CAPTURE_DEADLINE_MS = 3 * 86_400_000;

/** The review reason a settlement carries when the outcome stayed unknown too long. */
export const UNKNOWN_REVIEW_REASON = 'capture_outcome_unknown';

/** True once the outcome has been unknown for longer than the deadline. */
export function unknownExpired(
  unknownSince: number | null,
  nowMs: number,
  deadlineMs: number = DEFAULT_UNKNOWN_DEADLINE_MS,
): boolean {
  return unknownSince !== null && nowMs - unknownSince > deadlineMs;
}

/** Milliseconds left before the deadline, or null when no unknown outcome is pending. */
export function unknownTimeLeftMs(
  j: Pick<Journal, 'unknownSince'>,
  nowMs: number,
  deadlineMs: number = DEFAULT_UNKNOWN_DEADLINE_MS,
): number | null {
  if (j.unknownSince === null) return null;
  return Math.max(0, j.unknownSince + deadlineMs - nowMs);
}
