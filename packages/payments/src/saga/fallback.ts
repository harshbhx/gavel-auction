import type { Journal } from '../types.js';

/**
 * Runner-up fallback facts (SPEC 3.5, R-PAY-053, R-PAY-065).
 *
 * The fallback itself is driven by the capture phase: after a definite capture
 * failure it reads the hold truth first, adopts a capture that is already there,
 * and only otherwise records the failure (`definite_fail`, state
 * FALLBACK_RUNNER_UP) and moves the cursor to the next candidate, priced at its
 * own planned price. This module names what a viewer needs to see about that step.
 */

export interface FallbackInfo {
  /** The bidder whose capture failed definitely. */
  fromBidderId: string;
  /** The next candidate, or null when none is left (the lot is not sold). */
  toBidderId: string | null;
  /** Why the capture failed: a mapped error kind or a hold truth reason. */
  reason: string;
}

/** The fallback in progress for a journal in FALLBACK_RUNNER_UP; null in any other state. */
export function fallbackOf(journal: Journal): FallbackInfo | null {
  if (journal.state !== 'FALLBACK_RUNNER_UP') return null;
  const last = journal.failed[journal.failed.length - 1];
  if (last === undefined) return null;
  return {
    fromBidderId: last.bidderId,
    toBidderId: journal.plan.candidates[journal.cursor + 1]?.bidderId ?? null,
    reason: last.reason,
  };
}
