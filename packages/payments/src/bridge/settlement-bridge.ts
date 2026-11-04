import { planWithSkipped, type PlanOutcome, type SkippedCandidate } from '../saga/plan.js';
import { promoteIntents } from '../saga/bridge.js';
import type { HoldRecord, HoldRef, Journal, SettlementPlan } from '../types.js';
import type { BridgeEngine, BridgeLot } from './types.js';

/**
 * The bridge from payments events to engine commands (R-ENG-044, R-ENG-054,
 * R-ENG-064, R-ENG-066, R-ENG-067, R-PAY-037).
 *
 * Command order for one lot, which the engine enforces:
 *   1. `prepare`: PromoteRunnerUp for every leader the plan had to skip, before
 *      the first capture, so the engine's winner is the bidder who is charged.
 *   2. `recordProgress`: RecordSettlement for each saga history entry, while the
 *      lot is SETTLING. Entries from before the hammer (HELD -> BIDDING) are
 *      recorded after it; the engine only accepts them in saga order.
 *   3. `finish`: CompleteLot last, once the saga is SETTLED; the lot is DONE after
 *      that and takes no RecordSettlement. A settlement that ended with nobody
 *      charged turns the lot unsold through PromoteRunnerUp.
 *   4. `closeIfDone`: CloseAuction once every lot is DONE.
 *
 * Every step reads the engine first and sends only what is missing, so a retry
 * after a crash never sends a command twice.
 *
 * A kill-switch cancel before the hammer (HELD or BIDDING -> VOIDING) leaves the
 * lot OPEN; it is recorded with the engine AbortLot command, which the host sends
 * and this bridge does not. Those journal entries are not replayed by recordProgress.
 */

export class BridgeError extends Error {
  readonly code: 'winner_mismatch' | 'unknown_lot' | 'engine_diverged';
  constructor(code: BridgeError['code'], message: string) {
    super(message);
    this.name = 'BridgeError';
    this.code = code;
  }
}

export type PrepareResult =
  | { status: 'ready'; plan: SettlementPlan; promoted: SkippedCandidate[] }
  /** The engine ended the lot unsold while promoting; holds still need releasing. */
  | { status: 'unsold'; plan: SettlementPlan; promoted: SkippedCandidate[] };

export type FinishResult =
  | { status: 'completed'; bidderId: string; capturedCents: number }
  | { status: 'unsold' }
  /** The saga ended in FAILED_NEEDS_REVIEW: the lot stays SETTLING until an operator acts. */
  | { status: 'needs_review' }
  /** The saga has not reached a final state yet. */
  | { status: 'pending' };

export type CloseResult = { status: 'closed' } | { status: 'open_lots'; lotIds: string[] };

const REVOKE_BY_HOLD = {
  DENIED: 'declined',
  EXPIRED: 'expired',
  VOIDED: 'voided',
} as const;

/** The RevokeCeiling reason for a hold that can no longer be charged, or null. */
export function revokeReasonFor(
  status: HoldRecord['status'],
): 'declined' | 'expired' | 'voided' | null {
  return status === 'DENIED' || status === 'EXPIRED' || status === 'VOIDED'
    ? REVOKE_BY_HOLD[status]
    : null;
}

/** The ref that ties a SETTLEMENT_STATE entry to the journal history entry it records. */
export function settlementRef(lotId: string, seq: number): string {
  return `saga:${lotId}:${seq}`;
}

export class SettlementBridge {
  constructor(private readonly engine: BridgeEngine) {}

  private async lot(auctionId: string, lotId: string): Promise<BridgeLot> {
    const lot = (await this.engine.lots(auctionId)).find((l) => l.lotId === lotId);
    if (lot === undefined) throw new BridgeError('unknown_lot', lotId);
    return lot;
  }

  /**
   * A hold went DENIED, EXPIRED or VOIDED (webhook or sweep): the bidder's ceiling
   * is revoked. Safe to repeat; the engine treats a second revoke as a no-op.
   */
  async onHoldStatus(auctionId: string, hold: HoldRecord): Promise<boolean> {
    const reason = revokeReasonFor(hold.status);
    if (reason === null) return false;
    await this.engine.dispatch(auctionId, {
      type: 'RevokeCeiling',
      bidderId: hold.bidderId,
      holdRef: hold.holdId,
      reason,
    });
    return true;
  }

  /**
   * Builds the settlement plan from the engine's hammer outcome and tells the
   * engine about every leader the plan could not charge, before the saga runs.
   * Throws BridgeError('engine_diverged') when, after promotion, the engine's
   * winner is not the first bidder the saga will charge.
   */
  async prepare(
    auctionId: string,
    outcome: PlanOutcome,
    holds: Record<string, HoldRef>,
    reserveCents: number,
  ): Promise<PrepareResult> {
    const { plan, skipped } = planWithSkipped(outcome, holds, reserveCents);
    const order = outcome.candidates.map((c) => c.bidderId);
    const planned = plan.candidates.map((c) => c.bidderId);
    const intents = promoteIntents(outcome.lotId, skipped, planned, order);
    const promoted: SkippedCandidate[] = [];
    const target = planned[0];

    for (let i = 0; i <= order.length; i++) {
      const lot = await this.lot(auctionId, outcome.lotId);
      if (lot.status === 'DONE') return { status: 'unsold', plan, promoted };
      if (lot.winnerId === null || lot.winnerId === target) break;
      const intent = intents.find((x) => x.disqualifiedBidderId === lot.winnerId);
      if (intent === undefined) {
        throw new BridgeError(
          'engine_diverged',
          `engine winner ${lot.winnerId} is not the first chargeable bidder`,
        );
      }
      await this.engine.dispatch(auctionId, intent);
      const hit = skipped.find((s) => s.bidderId === intent.disqualifiedBidderId);
      if (hit !== undefined) promoted.push(hit);
    }

    const after = await this.lot(auctionId, outcome.lotId);
    if (after.status === 'DONE') return { status: 'unsold', plan, promoted };
    if (target !== undefined && after.winnerId !== target) {
      throw new BridgeError('engine_diverged', `engine winner is ${after.winnerId}, not ${target}`);
    }
    return { status: 'ready', plan, promoted };
  }

  /**
   * Records the journal's history entries the engine does not have yet, in order.
   * Needs the lot to be SETTLING; returns how many were sent.
   */
  async recordProgress(auctionId: string, journal: Journal): Promise<number> {
    const lotId = journal.auctionId;
    const lot = await this.lot(auctionId, lotId);
    if (lot.status !== 'SETTLING' && lot.status !== 'DONE') return 0;
    const done = new Set(await this.engine.settlementRefs(auctionId, lotId));
    // A DONE lot (unsold or aborted) already sits at some recorded state; the history
    // before that point is not replayed, only the steps from it to the end (R-ENG-067).
    let waiting = lot.status === 'DONE';
    let sent = 0;
    for (const h of journal.history) {
      const ref = settlementRef(lotId, h.seq);
      if (done.has(ref)) continue;
      if (waiting) {
        if (h.from !== lot.settlement) continue;
        waiting = false;
      }
      await this.engine.dispatch(auctionId, {
        type: 'RecordSettlement',
        lotId,
        from: h.from,
        to: h.to,
        ref,
      });
      sent += 1;
    }
    return sent;
  }

  /**
   * Final step for a lot once the saga stops: records the history, then sends
   * CompleteLot with the bidder the saga charged. Throws winner_mismatch when the
   * engine's winner is a different bidder, so a capture is never booked to the
   * wrong person (R-ENG-066).
   */
  async finish(auctionId: string, journal: Journal): Promise<FinishResult> {
    const lotId = journal.auctionId;
    if (journal.state === 'FAILED_NEEDS_REVIEW') {
      await this.recordProgress(auctionId, journal);
      return { status: 'needs_review' };
    }
    if (journal.state !== 'SETTLED') return { status: 'pending' };
    let lot = await this.lot(auctionId, lotId);
    if (lot.status === 'DONE') {
      await this.recordProgress(auctionId, journal);
      return this.describe(journal, lot);
    }
    await this.recordProgress(auctionId, journal);
    lot = await this.lot(auctionId, lotId);

    const won = journal.winner;
    if (won === null) {
      await this.makeUnsold(auctionId, lotId);
      return { status: 'unsold' };
    }
    lot = await this.promoteToCharged(auctionId, lotId, journal, won.bidderId);
    if (lot.winnerId !== won.bidderId) {
      throw new BridgeError(
        'winner_mismatch',
        `engine winner ${lot.winnerId} but ${won.bidderId} was charged`,
      );
    }
    await this.engine.dispatch(auctionId, {
      type: 'CompleteLot',
      lotId,
      bidderId: won.bidderId,
      capturedCents: won.amountCents,
      ref: won.captureId,
    });
    return { status: 'completed', bidderId: won.bidderId, capturedCents: won.amountCents };
  }

  /**
   * A capture that failed definitely makes the saga charge the next candidate, but
   * the engine still names the failed bidder as winner. Walk the journal's failed
   * bidders and promote past each one while it is the engine's winner, re-reading
   * the lot every time, until the engine winner is the charged bidder. A winner the
   * journal did not fail is never promoted (R-PAY-053, R-ENG-066).
   */
  private async promoteToCharged(
    auctionId: string,
    lotId: string,
    journal: Journal,
    chargedId: string,
  ): Promise<BridgeLot> {
    for (let i = 0; i <= journal.failed.length; i++) {
      const lot = await this.lot(auctionId, lotId);
      if (lot.status === 'DONE' || lot.winnerId === null || lot.winnerId === chargedId) return lot;
      const failure = journal.failed.find((f) => f.bidderId === lot.winnerId);
      if (failure === undefined) return lot;
      await this.engine.dispatch(auctionId, {
        type: 'PromoteRunnerUp',
        lotId,
        disqualifiedBidderId: failure.bidderId,
        reason: failure.reason,
      });
    }
    return this.lot(auctionId, lotId);
  }

  private describe(journal: Journal, lot: BridgeLot): FinishResult {
    const won = journal.winner;
    if (won === null || lot.winnerId === null) return { status: 'unsold' };
    return { status: 'completed', bidderId: won.bidderId, capturedCents: won.amountCents };
  }

  /** Nobody was charged: promote past every remaining winner until the engine ends the lot. */
  private async makeUnsold(auctionId: string, lotId: string): Promise<void> {
    for (let i = 0; i < 64; i++) {
      const lot = await this.lot(auctionId, lotId);
      if (lot.status === 'DONE' || lot.winnerId === null) return;
      await this.engine.dispatch(auctionId, {
        type: 'PromoteRunnerUp',
        lotId,
        disqualifiedBidderId: lot.winnerId,
        reason: 'no capture',
      });
    }
    throw new BridgeError('engine_diverged', `lot ${lotId} did not become unsold`);
  }

  /**
   * CloseAuction when every lot is DONE; otherwise the lots still open, which
   * includes any lot waiting in FAILED_NEEDS_REVIEW (the head is not anchored
   * until an operator resolves it).
   */
  async closeIfDone(auctionId: string): Promise<CloseResult> {
    const open = (await this.engine.lots(auctionId)).filter((l) => l.status !== 'DONE');
    if (open.length > 0) return { status: 'open_lots', lotIds: open.map((l) => l.lotId) };
    await this.engine.dispatch(auctionId, { type: 'CloseAuction' });
    return { status: 'closed' };
  }
}
