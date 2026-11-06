import { PROMOTE_REF_PREFIX } from '../commands.js';
import type { Command } from '../commands.js';
import { EngineError } from '../errors.js';
import type { LedgerEvent } from '../events.js';
import { candidates } from '../rules/candidates.js';
import { bidderFor, available, scopeKey, standingExposure } from '../rules/exposure.js';
import type { AuctionState } from '../state.js';
import { assertNotInPast } from './setup.js';
import type { DecideResult } from './setup.js';

/** Settlement states from which a promoted winner can still be charged when nothing was captured. */
const PROMOTABLE_SETTLEMENTS: ReadonlySet<string> = new Set([
  'HELD',
  'BIDDING',
  'WINNER_SELECTED',
  'CAPTURING',
  'FALLBACK_RUNNER_UP',
]);

export type PromoteCommand = Extract<Command, { type: 'PromoteRunnerUp' }>;

/**
 * Decides PromoteRunnerUp (R-ENG-054..060). Valid for a SETTLING lot and its current
 * winner only. The candidates are recomputed without every bidder already demoted or
 * skipped (R-ENG-055); a candidate without headroom or with a revoked ceiling is
 * skipped and the next one is tried in the same batch (R-ENG-056). When none is left,
 * or the depth passes `maxFallbackDepth`, the lot is unsold (R-ENG-057). Releasing the
 * demoted winner's amount and charging the promoted one follows from the reducer,
 * because committed amounts are derived from the lot's winner and price (R-ENG-058).
 */
export function decidePromote(state: AuctionState, cmd: PromoteCommand): DecideResult {
  assertNotInPast(state, cmd);
  if (state.auctionId === null) throw new EngineError('bad_command', 'auction not created');
  if (state.closed) throw new EngineError('auction_closed');
  const lot = state.lots[cmd.lotId];
  if (lot === undefined) throw new EngineError('bad_command', 'unknown lot');
  if (lot.status === 'DONE') throw new EngineError('lot_done');
  if (lot.status !== 'SETTLING') throw new EngineError('cannot_promote', lot.status);
  if (lot.winnerId === null || lot.winnerId !== cmd.disqualifiedBidderId) {
    throw new EngineError('not_current_winner', cmd.disqualifiedBidderId);
  }
  // Money already captured and not yet released belongs to the winner who paid; moving the
  // lot to a runner-up now would book the capture to a bidder who never paid (R8-E01).
  // The settlement bridge replays a whole history up to SETTLED and only then promotes to
  // the bidder it charged, so SETTLED stays allowed. Any other state after a capture, FAILED_NEEDS_REVIEW
  // included, is refused (R9-M01).
  if (lot.captureSeen && lot.settlement !== 'SETTLED') {
    throw new EngineError('state_continuity', `cannot promote while ${lot.settlement}`);
  }
  // Without a capture, VOIDING, SETTLED and FAILED_NEEDS_REVIEW have no edge back to a state that
  // can charge a new winner; naming one would leave the lot in SETTLING with its amount reserved.
  // Only a release (unsold) or the operator review edges lead out of them.
  const canCharge = lot.captureSeen
    ? lot.settlement === 'SETTLED'
    : PROMOTABLE_SETTLEMENTS.has(lot.settlement);
  const unsoldEvent = (): LedgerEvent => ({
    type: 'LOT_UNSOLD',
    payload: {
      lotId: cmd.lotId,
      reason: 'no_valid_winner',
      disqualifiedBidderId: cmd.disqualifiedBidderId,
      promoteReason: cmd.reason,
    },
  });
  // A lot caught mid capture goes through the recorded fallback step before the release,
  // because the payments graph has no direct CAPTURING to VOIDING edge (R4-E10).
  const unsoldEvents = (): LedgerEvent[] =>
    lot.settlement === 'CAPTURING'
      ? [
          {
            type: 'SETTLEMENT_STATE',
            payload: {
              lotId: cmd.lotId,
              from: 'CAPTURING',
              to: 'FALLBACK_RUNNER_UP',
              ref: `${PROMOTE_REF_PREFIX}${cmd.reason}`,
            },
          },
          unsoldEvent(),
        ]
      : [unsoldEvent()];
  // After a recorded capture the money belongs to a sale: a promotion may move the lot to the
  // bidder the saga charged, never end it unsold (R12-E10).
  const unsold = (): DecideResult => {
    if (lot.captureSeen) {
      throw new EngineError('state_continuity', 'a captured lot cannot end unsold');
    }
    return { events: unsoldEvents(), outcome: { kind: 'accepted' } };
  };

  const max = state.config.maxFallbackDepth;
  if (state.config.fallbackPolicy === 'unsold') return unsold();

  const excluded = new Set<string>([cmd.disqualifiedBidderId, ...lot.demoted]);
  for (const s of lot.skipped) excluded.add(s.bidderId);
  const next = candidates(lot, excluded, max);

  const events: LedgerEvent[] = [];
  let depth = lot.depth;
  for (const cand of next) {
    depth += 1;
    if (depth > max) break;
    const bidder = bidderFor(state, cand.bidderId, cmd.lotId);
    // A candidate's best bid on the open lot stays reserved, leading or not, or that lot
    // could not be hammered later once the bid leads (ENG-R2-06, R12-E03).
    const headroom = Math.max(
      0,
      available(state, cand.bidderId, cmd.lotId) -
        standingExposure(state, cand.bidderId, scopeKey(state, cmd.lotId)),
    );
    if (bidder === undefined || bidder.revoked || cand.priceCents > headroom) {
      events.push({
        type: 'CANDIDATE_SKIPPED',
        payload: {
          lotId: cmd.lotId,
          bidderId: cand.bidderId,
          reason: bidder?.revoked === true ? 'ceiling_revoked' : 'ceiling_insufficient',
          depth,
          priceCents: cand.priceCents,
        },
      });
      continue;
    }
    if (!canCharge) {
      throw new EngineError('state_continuity', `cannot promote while ${lot.settlement}`);
    }
    events.push({
      type: 'FALLBACK_PROMOTED',
      payload: {
        lotId: cmd.lotId,
        from: cmd.disqualifiedBidderId,
        to: cand.bidderId,
        priceCents: cand.priceCents,
        depth,
        reason: cmd.reason,
      },
    });
    return { events, outcome: { kind: 'accepted' } };
  }
  const end = unsold();
  return { events: [...events, ...end.events], outcome: end.outcome };
}
