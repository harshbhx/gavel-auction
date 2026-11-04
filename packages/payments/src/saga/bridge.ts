import type { SkippedCandidate } from './plan.js';

/**
 * Types and pure helpers for the bridge between the settlement saga and the
 * engine's commands. The bridge itself lives with the room runtime; this file
 * pins the shapes it needs from payments so the two sides cannot drift.
 *
 * Command order for one lot (engine rules, settlement.ts and close-auction.ts):
 *   1. PromoteRunnerUp for every candidate that planWithSkipped left out, before
 *      the first capture, so the engine's winner is the bidder who is charged.
 *   2. RecordSettlement for each saga transition, while the lot is SETTLING.
 *   3. CompleteLot last, after the saga reaches SETTLED: it moves the lot to DONE,
 *      and RecordSettlement is refused after that.
 *   4. CloseAuction once every lot is DONE.
 */

/** The fields of the engine's PromoteRunnerUp command that payments can fill in. */
export interface PromoteRunnerUpIntent {
  type: 'PromoteRunnerUp';
  lotId: string;
  disqualifiedBidderId: string;
  reason: string;
}

/** The fields of the engine's CompleteLot command; `bidderId` names who was charged. */
export interface CompleteLotIntent {
  type: 'CompleteLot';
  lotId: string;
  bidderId: string;
  capturedCents: number;
  ref: string;
}

/**
 * One PromoteRunnerUp intent per skipped candidate, in the engine's order.
 * Only a skipped candidate that is ahead of the first planned candidate (the
 * hammer winner and any bidder ranked above the first chargeable one) needs it;
 * later skips never held the lot.
 */
export function promoteIntents(
  lotId: string,
  skipped: readonly SkippedCandidate[],
  plannedBidderIds: readonly string[],
  engineOrder: readonly string[],
): PromoteRunnerUpIntent[] {
  const first = plannedBidderIds[0];
  const limit = first === undefined ? engineOrder.length : engineOrder.indexOf(first);
  return skipped
    .filter((s) => {
      const at = engineOrder.indexOf(s.bidderId);
      return at >= 0 && at < limit;
    })
    .map((s) => ({
      type: 'PromoteRunnerUp',
      lotId,
      disqualifiedBidderId: s.bidderId,
      reason: s.reason === 'no_hold' ? 'no hold' : 'price above hold',
    }));
}

/**
 * The version a RoomStore journal slot holds for a payments journal. Payments
 * creates a journal at version 0 and each step stores version + 1; RoomStore
 * starts absent at 0 and stores current + 1 on every put. So the slot version is
 * always the journal version plus one, and `expectedVersion` for a put is the
 * previous journal version plus one (0 for the create).
 */
export function roomStoreVersion(journalVersion: number): number {
  return journalVersion + 1;
}
