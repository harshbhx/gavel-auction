import type { Command } from '../commands.js';
import { EngineError } from '../errors.js';
import type { LedgerEvent } from '../events.js';
import { candidates } from '../rules/candidates.js';
import { bidderFor, available } from '../rules/exposure.js';
import type { AuctionState } from '../state.js';
import { assertNotInPast } from './setup.js';
import type { DecideResult } from './setup.js';

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
  const unsold = (): DecideResult => ({
    events: [{ type: 'LOT_UNSOLD', payload: { lotId: cmd.lotId, reason: 'no_valid_winner' } }],
    outcome: { kind: 'accepted' },
  });

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
    const headroom = available(state, cand.bidderId, cmd.lotId);
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
  events.push({ type: 'LOT_UNSOLD', payload: { lotId: cmd.lotId, reason: 'no_valid_winner' } });
  return { events, outcome: { kind: 'accepted' } };
}
