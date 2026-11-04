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

/**
 * Maps a hold status and the settlement state to a ladder step and label.
 * A hold that still reads HELD once the settlement is SETTLED was released
 * with the other non-winner authorizations; while a settlement is in
 * FAILED_NEEDS_REVIEW every non-terminal hold is shown as Checking.
 */
export function ladderStep(
  holdStatus: HoldStatus,
  settlementState?: SettlementState,
): LadderDisplay {
  let step = stepFor(holdStatus);
  if (step === 'held' && settlementState === 'SETTLED') step = 'released';
  if ((step === 'held' || step === 'checking') && settlementState === 'FAILED_NEEDS_REVIEW') {
    step = 'checking';
  }
  return { step, label: LABELS[step] };
}
