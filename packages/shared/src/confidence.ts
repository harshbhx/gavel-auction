/** Voice and the wire carry confidence as a fraction 0..1; the engine gate uses basis points 0..10000. */
export const MAX_CONFIDENCE_BPS = 10_000;

/** Convert a 0..1 confidence (or threshold) to integer basis points, clamped to 0..10000. NaN maps to 0. */
export function toBps(fraction: number): number {
  if (Number.isNaN(fraction)) return 0;
  return Math.min(MAX_CONFIDENCE_BPS, Math.max(0, Math.round(fraction * MAX_CONFIDENCE_BPS)));
}
