import { PayPalError } from './errors.js';

/** Smallest ceiling the auction engine registers (engine MIN_CEILING_CENTS). */
export const MIN_CEILING_CENTS = 100;

export interface CeilingRules {
  /** GAVEL_MAX_CEILING_CENTS. */
  maxCeilingCents: number;
  /**
   * The auction's quick-pick amounts. Informational only: a bidder may choose any whole-cent
   * ceiling from the minimum to the cap, so the list no longer limits the amount (FIX-78).
   */
  presetsCents?: readonly number[];
}

function refuse(message: string): never {
  throw new PayPalError({
    kind: 'ceiling_out_of_range',
    status: 0,
    name: 'ceiling_out_of_range',
    message,
    outcome: 'definite',
  });
}

/**
 * Validates a ceiling before any PayPal call (R-PAY-005, R-PAY-031). Returns the
 * ceiling on success; throws PayPalError kind `ceiling_out_of_range` otherwise.
 * Pure: performs no I/O.
 */
export function validateCeiling(ceilingCents: number, rules: CeilingRules): number {
  if (typeof ceilingCents !== 'number' || !Number.isSafeInteger(ceilingCents)) {
    return refuse('ceiling must be an integer number of cents');
  }
  if (ceilingCents < MIN_CEILING_CENTS) {
    return refuse(`ceiling ${ceilingCents} is below the minimum of ${MIN_CEILING_CENTS}`);
  }
  if (ceilingCents > rules.maxCeilingCents) {
    return refuse(`ceiling ${ceilingCents} exceeds the cap of ${rules.maxCeilingCents}`);
  }
  return ceilingCents;
}
