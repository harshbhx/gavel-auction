import { PayPalError } from './errors.js';

export interface CeilingRules {
  /** GAVEL_MAX_CEILING_CENTS. */
  maxCeilingCents: number;
  /**
   * The auction's allowed presets, passed in by the caller. When given (even
   * empty), the ceiling must be one of them; when omitted only the cap applies.
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
  if (ceilingCents <= 0) return refuse('ceiling must be positive');
  if (ceilingCents > rules.maxCeilingCents) {
    return refuse(`ceiling ${ceilingCents} exceeds the cap of ${rules.maxCeilingCents}`);
  }
  if (rules.presetsCents !== undefined && !rules.presetsCents.includes(ceilingCents)) {
    return refuse('ceiling is not one of the auction presets');
  }
  return ceilingCents;
}
