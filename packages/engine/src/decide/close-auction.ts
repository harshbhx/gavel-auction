import type { Command } from '../commands.js';
import { EngineError } from '../errors.js';
import type { AuctionState } from '../state.js';
import { assertNotInPast } from './setup.js';
import type { DecideResult } from './setup.js';

export type CloseAuctionCommand = Extract<Command, { type: 'CloseAuction' }>;

/**
 * Decides CloseAuction (R-ENG-064). Valid once every lot is DONE (settled or unsold);
 * the entry anchors the ledger head hash, and every later command fails `auction_closed`.
 */
export function decideCloseAuction(state: AuctionState, cmd: CloseAuctionCommand): DecideResult {
  assertNotInPast(state, cmd);
  if (state.auctionId === null) throw new EngineError('bad_command', 'auction not created');
  if (state.closed) throw new EngineError('auction_closed');
  for (const lotId of state.lotOrder) {
    const status = state.lots[lotId]?.status;
    if (status !== 'DONE') throw new EngineError('auction_open_lots', `${lotId} is ${status}`);
  }
  return {
    events: [{ type: 'AUCTION_CLOSED', payload: { headHash: state.head.hash } }],
    outcome: { kind: 'accepted' },
  };
}
