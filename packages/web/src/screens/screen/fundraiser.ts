/** Fundraiser thermometer maths. Integer cents only; nothing here touches the money path. */

import { parseUsdToCents } from '../../util/money';

/** Largest goal the server accepts: one billion dollars, in cents. */
export const MAX_GOAL_CENTS = 1_000_000_000_00;

export type GoalInput =
  | { kind: 'empty' }
  | { kind: 'ok'; cents: number }
  | { kind: 'invalid' }
  | { kind: 'tooBig' };

/** Reads the setup field: empty means no thermometer, anything else must be a positive USD amount. */
export function parseGoalInput(input: string): GoalInput {
  if (input.trim() === '') return { kind: 'empty' };
  const cents = parseUsdToCents(input);
  if (cents === null) return { kind: 'invalid' };
  if (cents > MAX_GOAL_CENTS) return { kind: 'tooBig' };
  return { kind: 'ok', cents };
}

/** Settlement states in which the winner's amount is reserved but not yet captured. */
const ON_HOLD_STATES: readonly string[] = ['WINNER_SELECTED', 'CAPTURING'];

export interface LotRaise {
  /** Sum of captured cents across the lot's holds. Only captured money counts as raised. */
  raisedCents: number;
  /** Reserved for the winner but not yet captured. Shown apart, never added to raised. */
  onHoldCents: number;
}

export interface Thermometer extends LotRaise {
  goalCents: number;
  /** Fill ratio from 0 to 1, clamped. Never above 1 even when the goal is passed. */
  fill: number;
  reached: boolean;
}

function whole(n: number): number {
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

/**
 * The captured total for a lot: the amount the server reported as captured (it reaches screens,
 * which never get per-hold amounts), else the sum of per-hold captured cents when those are known.
 */
export function capturedTotal(
  reportedCents: number | undefined,
  holds: readonly { capturedCents: number }[] | undefined,
): number {
  if (reportedCents !== undefined) return whole(reportedCents);
  return (holds ?? []).reduce((sum, h) => sum + whole(h.capturedCents), 0);
}

/**
 * What one lot has raised. `holds` are the per-hold settlement rows; `winningCents` is the hammer
 * price (null while the lot is open or passed); `auctionState` is the settlement state.
 */
export function lotRaise(
  capturedCents: number,
  winningCents: number | null,
  auctionState: string | null,
): LotRaise {
  const raisedCents = whole(capturedCents);
  const pending =
    winningCents !== null && auctionState !== null && ON_HOLD_STATES.includes(auctionState)
      ? Math.max(0, whole(winningCents) - raisedCents)
      : 0;
  return { raisedCents, onHoldCents: pending };
}

/** The thermometer for a goal, or null when no valid goal is set (hidden by default). */
export function thermometer(
  goalCents: number | null | undefined,
  raise: LotRaise,
): Thermometer | null {
  if (goalCents === null || goalCents === undefined) return null;
  if (!Number.isSafeInteger(goalCents) || goalCents <= 0) return null;
  const ratio = raise.raisedCents / goalCents;
  return {
    ...raise,
    goalCents,
    fill: Math.min(1, Math.max(0, ratio)),
    reached: raise.raisedCents >= goalCents,
  };
}

/** Total across lots. Goals add up only when every lot has one; otherwise there is no total. */
export function totalRaise(
  lots: readonly { goalCents: number | null; raise: LotRaise }[],
): Thermometer | null {
  if (lots.length === 0) return null;
  let goal = 0;
  const sum: LotRaise = { raisedCents: 0, onHoldCents: 0 };
  for (const lot of lots) {
    if (lot.goalCents === null || lot.goalCents <= 0) return null;
    goal += lot.goalCents;
    sum.raisedCents += lot.raise.raisedCents;
    sum.onHoldCents += lot.raise.onHoldCents;
  }
  return thermometer(goal, sum);
}
