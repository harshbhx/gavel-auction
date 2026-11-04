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
 * fallback and no voids.
 */

/** R-PAY-055 default: ten minutes. */
export const DEFAULT_UNKNOWN_DEADLINE_MS = 600_000;

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
