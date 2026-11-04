import type { RejectReason } from '../reasons.js';
import { incrementAt } from './increment.js';
import type { PricingLot } from './pricing-basic.js';
import type { RankedBid } from './ranking.js';

/**
 * Proxy price (R-ENG-019): reserve with one bidder, otherwise
 * max(reserve, min(top, second + increment(second))). Null with no bids.
 * Equal maximums are already ordered by (at, seq) in `ranked` (R-ENG-021).
 */
export function currentPrice(lot: PricingLot, ranked: readonly RankedBid[]): number | null {
  const top = ranked[0];
  if (top === undefined) return null;
  const second = ranked[1];
  if (second === undefined) return lot.reserveCents;
  const stepped = second.amountCents + incrementAt(lot.increment, second.amountCents);
  return Math.max(lot.reserveCents, Math.min(top.amountCents, stepped));
}

/** The winner pays the current proxy price. */
export function hammerPrice(lot: PricingLot, ranked: readonly RankedBid[]): number | null {
  return currentPrice(lot, ranked);
}

/** Proxy bid checks: reserve and own-maximum raise rule (R-ENG-020). */
export function checkProxyBid(
  lot: PricingLot,
  ranked: readonly RankedBid[],
  bidderId: string,
  amountCents: number,
): RejectReason | null {
  if (amountCents < lot.reserveCents) return 'below_reserve';
  const own = ranked.find((r) => r.bidderId === bidderId);
  if (own !== undefined && amountCents <= own.amountCents) return 'not_higher_than_own_max';
  return null;
}
