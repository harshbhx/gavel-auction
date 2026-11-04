import type { Command } from '../commands.js';
import { EngineError } from '../errors.js';
import type { LedgerEvent } from '../events.js';
import type { AuctionState } from '../state.js';
import { assertNotInPast } from './setup.js';
import type { DecideResult } from './setup.js';

export type RevokeCommand = Extract<Command, { type: 'RevokeCeiling' }>;

/**
 * Decides RevokeCeiling (R-ENG-044). Appends CEILING_REVOKED, and while a lot is OPEN
 * or CLOSING one BID_STRUCK per active bid of the bidder; the ranking is recomputed
 * by the reducer. After a hammer only the revocation is recorded. A bidder that is
 * already revoked is a noop.
 */
export function decideRevoke(state: AuctionState, cmd: RevokeCommand): DecideResult {
  assertNotInPast(state, cmd);
  if (state.auctionId === null) throw new EngineError('bad_command', 'auction not created');
  if (state.closed) throw new EngineError('auction_closed');
  const records = Object.values(state.bidders).filter((b) => b.bidderId === cmd.bidderId);
  if (records.length === 0) throw new EngineError('bad_command', 'unknown bidder');
  if (records.every((b) => b.revoked)) return { events: [], outcome: { kind: 'noop' } };

  const events: LedgerEvent[] = [
    { type: 'CEILING_REVOKED', payload: { bidderId: cmd.bidderId, reason: cmd.reason } },
  ];
  for (const lotId of state.lotOrder) {
    const lot = state.lots[lotId];
    if (lot === undefined || (lot.status !== 'OPEN' && lot.status !== 'CLOSING')) continue;
    for (const b of lot.bids) {
      if (b.bidderId !== cmd.bidderId || b.status !== 'active') continue;
      events.push({
        type: 'BID_STRUCK',
        payload: { bidId: b.bidId, lotId, bidderId: cmd.bidderId, reason: cmd.reason },
      });
    }
  }
  return { events, outcome: { kind: 'accepted' } };
}
