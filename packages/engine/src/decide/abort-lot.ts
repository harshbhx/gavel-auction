import type { Command } from '../commands.js';
import { EngineError } from '../errors.js';
import type { AuctionState } from '../state.js';
import { LIMITS } from '../types.js';
import { assertNotInPast } from './setup.js';
import type { DecideResult } from './setup.js';

export type AbortLotCommand = Extract<Command, { type: 'AbortLot' }>;

/**
 * Decides AbortLot (ENG-90): the kill switch before the hammer. A PENDING, OPEN or
 * CLOSING lot is cancelled and becomes DONE with no winner, so the payments saga can
 * void every hold. A hammered lot is refused (`lot_frozen`, settle it instead) and a
 * DONE lot is refused (`lot_done`). Bids stay in the ledger; nothing is struck.
 */
export function decideAbortLot(state: AuctionState, cmd: AbortLotCommand): DecideResult {
  assertNotInPast(state, cmd);
  if (state.auctionId === null) throw new EngineError('bad_command', 'auction not created');
  if (state.closed) throw new EngineError('auction_closed');
  if (cmd.reason.length > LIMITS.text) throw new EngineError('limit_exceeded', 'reason');
  if (cmd.actor.length > LIMITS.text) throw new EngineError('limit_exceeded', 'actor');
  const lot = state.lots[cmd.lotId];
  if (lot === undefined) throw new EngineError('bad_command', 'unknown lot');
  if (lot.status === 'DONE') throw new EngineError('lot_done');
  if (lot.status === 'SETTLING') throw new EngineError('lot_frozen');
  return {
    events: [
      {
        type: 'LOT_ABORTED',
        payload: { lotId: cmd.lotId, reason: cmd.reason, actor: cmd.actor },
      },
    ],
    outcome: { kind: 'accepted' },
  };
}
