import { bidderKey } from '../state.js';
import type { AuctionState, BidderState } from '../state.js';

/** holdScope key of a lot: one shared key for `event`, the lot itself for `lot`. */
export function scopeKey(state: AuctionState, lotId: string): string {
  return state.config.holdScope === 'event' ? 'event' : lotId;
}

/** The bidder's ceiling record applying to a lot, or undefined if not registered. */
export function bidderFor(
  state: AuctionState,
  bidderId: string,
  lotId: string,
): BidderState | undefined {
  return state.bidders[bidderKey(bidderId, state.config.holdScope === 'lot' ? lotId : undefined)];
}

/**
 * R-ENG-043: sum of hammer prices of lots the bidder currently holds as winner
 * (SETTLING or DONE) within the holdScope key. Unsold and demoted lots do not count.
 */
export function committed(state: AuctionState, bidderId: string, key: string): number {
  let sum = 0;
  for (const lot of Object.values(state.lots)) {
    if (scopeKey(state, lot.lotId) !== key) continue;
    if (lot.status !== 'SETTLING' && lot.status !== 'DONE') continue;
    if (lot.winnerId === bidderId && lot.priceCents !== null) sum += lot.priceCents;
  }
  return sum;
}

/**
 * Standing exposure on lots that are still OPEN or CLOSING: the bidder's best active bid on
 * each such lot within the holdScope key, whether or not it leads now. A bid that trails can
 * lead later when the leader is revoked, and the hammer must still find it within the
 * ceiling (ENG-R2-06, R12-E03).
 */
export function standingExposure(state: AuctionState, bidderId: string, key: string): number {
  let sum = 0;
  for (const lot of Object.values(state.lots)) {
    if (scopeKey(state, lot.lotId) !== key) continue;
    if (lot.status !== 'OPEN' && lot.status !== 'CLOSING') continue;
    sum += lot.best[bidderId]?.amountCents ?? 0;
  }
  return sum;
}

/**
 * R-ENG-042: ceiling minus committed for the lot's holdScope key. Zero for an
 * unregistered or revoked bidder. The holdRef is never read here (R-ENG-046).
 */
export function available(state: AuctionState, bidderId: string, lotId: string): number {
  const b = bidderFor(state, bidderId, lotId);
  if (b === undefined || b.revoked) return 0;
  return Math.max(0, b.ceilingCents - committed(state, bidderId, scopeKey(state, lotId)));
}
