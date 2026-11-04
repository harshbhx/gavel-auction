/** Ceiling presets offered to bidders, in cents (R-ENG-014). */
export const CEILING_PRESETS_CENTS = [10000, 25000, 50000, 100000] as const;

/** Smallest ceiling a bidder can register. */
export const MIN_CEILING_CENTS = 100;

/** Sandbox demo cap used as the default `maxCeilingCents`. */
export const DEFAULT_MAX_CEILING_CENTS = 100000;

/** R-ENG-040: a ceiling must be an integer within [MIN_CEILING_CENTS, max]. */
export function checkCeiling(cents: number, max: number): 'ok' | 'bad_ceiling' {
  if (!Number.isSafeInteger(cents)) return 'bad_ceiling';
  return cents >= MIN_CEILING_CENTS && cents <= max ? 'ok' : 'bad_ceiling';
}
