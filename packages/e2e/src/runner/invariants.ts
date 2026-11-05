import { exportJsonl, verifyJsonl, type LedgerEntry } from '@gavel/engine';
import type { Invariant } from '../dsl/types';

/** What the runner observed for one hold after the run; money in integer cents. */
export interface HoldView {
  actor: string;
  holdCents: number;
  ceilingCents: number;
  capturedCents: number;
  releasedCents: number;
  captureCount: number;
  voided: boolean;
}

export interface InvariantInput {
  winner: string | null;
  holds: readonly HoldView[];
  entries: readonly LedgerEntry[];
  /** True when the fake PayPal server's own invariant check passed. */
  fakeOk: boolean;
}

/**
 * I1 at most one capture across all holds, I2 nothing captured above the winner's ceiling,
 * I3 every loser hold is voided and never captured, I4 held money equals captured plus released,
 * I5 the ledger hash chain verifies.
 */
export function evaluateInvariants(input: InvariantInput): Record<Invariant, boolean> {
  const { holds, winner } = input;
  const winnerHold = holds.find((h) => h.actor === winner);
  const captures = holds.reduce((n, h) => n + h.captureCount, 0);
  const heldTotal = holds.reduce((n, h) => n + h.holdCents, 0);
  const settledTotal = holds.reduce((n, h) => n + h.capturedCents + h.releasedCents, 0);
  const chain = verifyJsonl(exportJsonl(input.entries));
  return {
    I1: input.fakeOk && captures <= 1,
    I2: winnerHold === undefined || winnerHold.capturedCents <= winnerHold.ceilingCents,
    I3: holds.every((h) => h.actor === winner || (h.voided && h.captureCount === 0)),
    I4: heldTotal === settledTotal,
    I5: chain.ok === true,
  };
}
