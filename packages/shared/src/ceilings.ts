/**
 * The ceiling policy every package must agree on (INTEGRATION-RT-04). The engine, payments and
 * the room's auction config copy these values; `server/test/ceiling-policy.test.ts` fails when a
 * copy drifts.
 */

/** Ceiling presets offered to bidders, in cents ($100, $250, $500, $1000). */
export const CEILING_PRESETS_CENTS = [10000, 25000, 50000, 100000] as const;

/** Smallest ceiling a bidder can register or hold, in cents. */
export const MIN_CEILING_CENTS = 100;

/** Largest cap the engine can run (GAVEL_MAX_CEILING_CENTS must be MIN_CEILING_CENTS..this). */
export const MAX_CEILING_CENTS_LIMIT = 5_000_000_000;

/** Default cap on a ceiling, in cents ($50,000,000, sandbox); the largest preset must fit under it. */
export const DEFAULT_MAX_CEILING_CENTS = 5_000_000_000;
