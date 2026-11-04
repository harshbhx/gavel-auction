import { PayPalError } from './errors.js';

export interface CeilingRules {
  /** GAVEL_MAX_CEILING_CENTS. */
  maxCeilingCents: number;
  /**
   * The auction's allowed presets, passed in by the caller. Required: the ceiling
   * must be one of them, and an empty list refuses every ceiling. A caller that
   * has no list gets a refusal, never a pass.
   */
  presetsCents: readonly number[];
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
  // The type requires the list; a caller that bypasses it (plain JS, a cast) fails closed.
  const presets: unknown = rules.presetsCents;
  if (!Array.isArray(presets) || !presets.includes(ceilingCents)) {
    return refuse('ceiling is not one of the auction presets');
  }
  return ceilingCents;
}
