import type { HoldStatus, SettlementState } from './types.js';

export type LadderStep = 'held' | 'charged' | 'released' | 'declined' | 'checking';

export interface LadderDisplay {
  step: LadderStep;
  /** Plain-text label for the web area to render and to extend with screen-reader text. */
  label: string;
}

const LABELS: Record<LadderStep, string> = {
  held: 'Held, not charged',
  charged: 'Charged at winning price',
  released: 'Released',
  declined: 'Declined',
  checking: 'Checking',
};

function stepFor(hold: HoldStatus): LadderStep {
  switch (hold) {
    case 'HELD':
      return 'held';
    case 'CAPTURED':
      return 'charged';
    case 'VOIDED':
    case 'EXPIRED':
      return 'released';
    case 'DENIED':
      return 'declined';
    case 'PENDING_APPROVAL':
    case 'UNKNOWN':
      return 'checking';
  }
}

/** Whether this hold is the settlement's winner, a loser, or not known to the caller. */
export type LadderRole = 'winner' | 'other';

/**
 * Maps a hold status and the settlement state to a ladder step and label.
 *
 * Once the settlement is SETTLED a hold that still reads HELD is a record that has
 * not caught up: for the journal's winner (pass `role: 'winner'`, the bidder whose
 * holdId is journal.winner.holdId) the money was charged; for a known loser it was
 * released with the other authorizations; when the role is not known the step is
 * Checking, never a guess in either direction. While a settlement is in
 * FAILED_NEEDS_REVIEW every non-terminal hold is shown as Checking.
 */
export function ladderStep(
  holdStatus: HoldStatus,
  settlementState?: SettlementState,
  role?: LadderRole,
): LadderDisplay {
  let step = stepFor(holdStatus);
  if (step === 'held' && settlementState === 'SETTLED') {
    step = role === 'winner' ? 'charged' : role === 'other' ? 'released' : 'checking';
  }
  if (step === 'checking' && settlementState === 'SETTLED' && role === 'winner') step = 'charged';
  if ((step === 'held' || step === 'checking') && settlementState === 'FAILED_NEEDS_REVIEW') {
    step = 'checking';
  }
  return { step, label: LABELS[step] };
}
