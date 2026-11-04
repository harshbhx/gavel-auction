import type { IncrementRule } from '../types.js';

/**
 * Minimum increment at a given price (R-ENG-025). With a ladder this is the
 * incrementCents of the entry with the greatest fromCents <= price.
 */
export function incrementAt(rule: IncrementRule, price: number): number {
  if ('flatCents' in rule) return rule.flatCents;
  let inc = rule.ladder[0]?.incrementCents ?? 1;
  for (const step of rule.ladder) {
    if (step.fromCents <= price) inc = step.incrementCents;
    else break;
  }
  return inc;
}
