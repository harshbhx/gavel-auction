import type { Candidate, HoldRef, SettlementPlan } from '../types.js';

/** Structural subset of the engine outcome that the saga consumes. */
export interface PlanOutcome {
  auctionId: string;
  /** Hammer price of the winner, in cents. */
  price: number;
  /** Best first; index 0 is the hammer winner. */
  ranking: ReadonlyArray<{ bidderId: string; amountCents: number }>;
}

/**
 * Builds a settlement plan: the winner at the hammer price, then each
 * runner-up at its own ranked amount. An empty ranking yields no candidates.
 * Throws when a bidder appears more than once in the ranking.
 */
export function planFromOutcome(
  outcome: PlanOutcome,
  holds: Record<string, HoldRef>,
  reserveCents: number,
): SettlementPlan {
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  outcome.ranking.forEach((entry, index) => {
    if (seen.has(entry.bidderId)) {
      throw new Error(`duplicate bidder in ranking: ${entry.bidderId}`);
    }
    seen.add(entry.bidderId);
    candidates.push({
      bidderId: entry.bidderId,
      priceCents: index === 0 ? outcome.price : entry.amountCents,
    });
  });
  return { auctionId: outcome.auctionId, reserveCents, candidates, holds: { ...holds } };
}
