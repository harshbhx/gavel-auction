import type { Command } from '../commands.js';
import { EngineError } from '../errors.js';
import type { LedgerEvent } from '../events.js';
import type { AuctionState } from '../state.js';
import type { Ulid } from '../types.js';
import { assertNotInPast } from './setup.js';
import type { DecideResult } from './setup.js';

export type RevokeCommand = Extract<Command, { type: 'RevokeCeiling' }>;

/** One BID_STRUCK per active bid of the bidder on each lot still OPEN or CLOSING. */
function strikes(
  state: AuctionState,
  cmd: RevokeCommand,
  lotIds: readonly string[],
): LedgerEvent[] {
  const out: LedgerEvent[] = [];
  for (const lotId of lotIds) {
    const lot = state.lots[lotId];
    if (lot === undefined || (lot.status !== 'OPEN' && lot.status !== 'CLOSING')) continue;
    for (const b of lot.bids) {
      if (b.bidderId !== cmd.bidderId || b.status !== 'active') continue;
      out.push({
        type: 'BID_STRUCK',
        payload: { bidId: b.bidId, lotId: lot.lotId, bidderId: cmd.bidderId, reason: cmd.reason },
      });
    }
  }
  return out;
}

/**
 * Decides RevokeCeiling (R-ENG-044). Appends CEILING_REVOKED, and while a lot is OPEN
 * or CLOSING one BID_STRUCK per active bid of the bidder; the ranking is recomputed
 * by the reducer. After a hammer only the revocation is recorded. A bidder that is
 * already revoked is a noop.
 *
 * Under holdScope lot each lot's ceiling is backed by its own hold. A revocation naming a
 * holdRef that backs lot records revokes and strikes on those lots only, and each
 * CEILING_REVOKED names its lot; the bidder's other lots keep their own holds (R12-E09). A
 * revocation without a holdRef, or under holdScope event, covers the bidder everywhere.
 */
export function decideRevoke(state: AuctionState, cmd: RevokeCommand): DecideResult {
  assertNotInPast(state, cmd);
  if (state.auctionId === null) throw new EngineError('bad_command', 'auction not created');
  if (state.closed) throw new EngineError('auction_closed');
  const records = Object.values(state.bidders).filter((b) => b.bidderId === cmd.bidderId);
  if (records.length === 0) throw new EngineError('bad_command', 'unknown bidder');
  const noop: DecideResult = { events: [], outcome: { kind: 'noop' } };
  if (records.every((b) => b.revoked && b.revokedLotOnly !== true)) return noop;
  // A hold that was replaced by a raise no longer backs the bidder; its late failure
  // must not revoke the ceiling the newer hold still covers (ENG-R3-05).
  if (
    cmd.holdRef !== undefined &&
    records.some((b) => b.holdRef !== null) &&
    !records.some((b) => b.holdRef === cmd.holdRef)
  ) {
    return noop;
  }
  const base = {
    bidderId: cmd.bidderId,
    reason: cmd.reason,
    ...(cmd.holdRef === undefined ? {} : { holdRef: cmd.holdRef }),
  };

  const backed =
    cmd.holdRef !== undefined && state.config.holdScope === 'lot'
      ? records.filter((b) => b.holdRef === cmd.holdRef && b.lotId !== null)
      : [];
  if (backed.length > 0) {
    const live = backed.filter((b) => !b.revoked);
    if (live.length === 0) return noop;
    const events: LedgerEvent[] = [];
    for (const b of live) {
      const lotId = b.lotId as Ulid;
      events.push({ type: 'CEILING_REVOKED', payload: { ...base, lotId } });
      events.push(...strikes(state, cmd, [lotId]));
    }
    return { events, outcome: { kind: 'accepted' } };
  }

  const events: LedgerEvent[] = [{ type: 'CEILING_REVOKED', payload: base }];
  events.push(...strikes(state, cmd, state.lotOrder));
  return { events, outcome: { kind: 'accepted' } };
}
