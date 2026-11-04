import type { Candidate, HoldRef, SettlementPlan } from '../types.js';

/**
 * The part of the engine's LOT_HAMMERED payload the saga consumes. Structural, so
 * the engine's own event payload is assignable without a cast: `candidates` is the
 * engine's ordered fallback list (winner first), each priced as if every earlier
 * candidate were out (R-ENG-048, R-ENG-051). The ranking is not read: a runner-up
 * is never charged at its own maximum bid.
 */
export interface PlanOutcome {
  /** The lot the auction settles; it is the settlement's auction id. */
  lotId: string;
  winnerId: string;
  /** Hammer price of the winner, in cents. */
  priceCents: number;
  candidates: ReadonlyArray<{ bidderId: string; priceCents: number }>;
}

/** A candidate left out of the plan, so the caller can tell the engine (PromoteRunnerUp). */
export interface SkippedCandidate {
  bidderId: string;
  /** The engine's price for the candidate, in cents. */
  priceCents: number;
  reason: 'no_hold' | 'price_above_hold';
}

export interface PlanResult {
  plan: SettlementPlan;
  /** Candidates dropped from the plan, in the engine's order. */
  skipped: SkippedCandidate[];
}

/**
 * Builds a settlement plan from the engine's hammer outcome: the engine's
 * candidates in order, at the engine's prices. A candidate with no hold, or whose
 * price is above its own hold's ceiling, cannot be charged and is left out, so the
 * next candidate becomes the fallback instead of the whole plan being rejected
 * (R-PAY-044, R-PAY-062). Throws when the outcome is inconsistent: the first
 * candidate is not the winner at the hammer price, or a bidder appears twice.
 */
export function planFromOutcome(
  outcome: PlanOutcome,
  holds: Record<string, HoldRef>,
  reserveCents: number,
): SettlementPlan {
  return planWithSkipped(outcome, holds, reserveCents).plan;
}

/**
 * Like planFromOutcome, but also returns the candidates that were left out. A
 * skipped leader (the hammer winner among them) must reach the engine as a
 * PromoteRunnerUp before the first capture, otherwise the engine still believes
 * the skipped bidder won while another bidder is charged.
 */
export function planWithSkipped(
  outcome: PlanOutcome,
  holds: Record<string, HoldRef>,
  reserveCents: number,
): PlanResult {
  const first = outcome.candidates[0];
  if (first !== undefined) {
    if (first.bidderId !== outcome.winnerId || first.priceCents !== outcome.priceCents) {
      throw new Error('first candidate must be the winner at the hammer price');
    }
  }
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  const skipped: SkippedCandidate[] = [];
  for (const entry of outcome.candidates) {
    if (seen.has(entry.bidderId)) {
      throw new Error(`duplicate bidder in candidates: ${entry.bidderId}`);
    }
    seen.add(entry.bidderId);
    const hold = holds[entry.bidderId];
    if (hold === undefined || entry.priceCents > hold.ceilingCents) {
      skipped.push({
        bidderId: entry.bidderId,
        priceCents: entry.priceCents,
        reason: hold === undefined ? 'no_hold' : 'price_above_hold',
      });
      continue;
    }
    candidates.push({ bidderId: entry.bidderId, priceCents: entry.priceCents });
  }
  return {
    plan: { auctionId: outcome.lotId, reserveCents, candidates, holds: { ...holds } },
    skipped,
  };
}
