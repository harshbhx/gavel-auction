import type { Candidate } from '../events.js';
import type { LotState } from '../state.js';
import type { Ulid } from '../types.js';
import { hammerPrice as basicHammer } from './pricing-basic.js';
import type { PricingLot } from './pricing-basic.js';
import { hammerPrice as proxyHammer } from './pricing-proxy.js';
import { rank } from './ranking.js';
import type { RankedBid } from './ranking.js';

/** Price the first bidder of `ranked` would pay for the lot, or null with no bids (R-ENG-055). */
export function priceFor(lot: PricingLot, ranked: readonly RankedBid[]): number | null {
  return lot.mode === 'proxy' ? proxyHammer(lot, ranked) : basicHammer(lot, ranked);
}

/**
 * Winner first, then up to `depth` runner-ups, each priced as if every earlier
 * candidate were disqualified (R-ENG-051).
 */
export function candidatesOf(
  lot: PricingLot,
  ranked: readonly RankedBid[],
  depth: number,
): Candidate[] {
  const out: Candidate[] = [];
  const n = Math.min(ranked.length, depth + 1);
  for (let i = 0; i < n; i++) {
    const rest = ranked.slice(i);
    const price = priceFor(lot, rest);
    const who = rest[0];
    if (price === null || who === undefined) break;
    out.push({ bidderId: who.bidderId as Ulid, priceCents: price });
  }
  return out;
}

/**
 * Candidates of a lot with the `excluded` bidders removed from its active bids
 * (R-ENG-051, R-ENG-055). The price of each entry is the mode's pricing re-run over
 * the bids that remain after every earlier candidate is also removed.
 */
export function candidates(
  lot: LotState,
  excluded: ReadonlySet<string>,
  depth: number,
): Candidate[] {
  const cfg = lot.config;
  if (cfg === null) return [];
  const pl: PricingLot = {
    mode: cfg.mode,
    reserveCents: cfg.reserveCents,
    increment: cfg.increment,
  };
  const ranked = rank(lot.bids).filter((r) => !excluded.has(r.bidderId));
  return candidatesOf(pl, ranked, depth);
}
