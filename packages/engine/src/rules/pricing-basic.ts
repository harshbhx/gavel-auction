import { InvariantError } from '../errors.js';
import type { RejectReason } from '../reasons.js';
import type { IncrementRule, Mode } from '../types.js';
import { incrementAt } from './increment.js';
import type { RankedBid } from './ranking.js';

/** The slice of a lot configuration that pricing needs. */
export interface PricingLot {
  mode: Mode;
  reserveCents: number;
  increment: IncrementRule;
}

/**
 * Public current price. English: the highest active bid, or null with no bids.
 * Second price: always null while the lot is open (R-ENG-023).
 */
export function currentPrice(lot: PricingLot, ranked: readonly RankedBid[]): number | null {
  if (lot.mode !== 'english') return null;
  return ranked[0]?.amountCents ?? null;
}

/** Smallest acceptable next bid from a new bidder (R-ENG-016). */
export function minNextBid(lot: PricingLot, ranked: readonly RankedBid[]): number {
  const top = lot.mode === 'english' ? ranked[0]?.amountCents : undefined;
  if (top === undefined) return lot.reserveCents;
  return top + incrementAt(lot.increment, top);
}

/**
 * Hammer price for english and second_price lots, or null when there is no
 * bid. English: the winning bid (R-ENG-017). Second price: max(reserve,
 * second highest), or the reserve with a single bidder (R-ENG-023).
 */
export function hammerPrice(lot: PricingLot, ranked: readonly RankedBid[]): number | null {
  const top = ranked[0];
  if (top === undefined) return null;
  if (lot.mode === 'english') return top.amountCents;
  const second = ranked[1]?.amountCents ?? 0;
  return Math.max(lot.reserveCents, second);
}

/**
 * Mode specific price checks for english and second_price bids. Returns the
 * rejection reason or null when the amount is acceptable.
 */
export function checkBasicBid(
  lot: PricingLot,
  ranked: readonly RankedBid[],
  bidderId: string,
  amountCents: number,
): RejectReason | null {
  if (lot.mode === 'second_price') {
    if (ranked.some((r) => r.bidderId === bidderId)) return 'already_bid';
    return amountCents < lot.reserveCents ? 'below_reserve' : null;
  }
  const top = ranked[0];
  if (top === undefined) return amountCents < lot.reserveCents ? 'below_reserve' : null;
  if (top.bidderId === bidderId) return 'already_leading';
  return amountCents < minNextBid(lot, ranked) ? 'below_increment' : null;
}

/** R-ENG-026: the hammer price must fit the winner's available ceiling. */
export function assertWithinCeiling(priceCents: number, availableCeilingCents: number): void {
  if (priceCents > availableCeilingCents) {
    throw new InvariantError(
      'price_over_ceiling',
      `price ${priceCents} exceeds available ceiling ${availableCeilingCents}`,
    );
  }
}
