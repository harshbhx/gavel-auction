import type { Command } from '../commands.js';
import { EngineError } from '../errors.js';
import type { AuctionState } from '../state.js';
import { assertNotInPast } from './setup.js';
import type { DecideResult } from './setup.js';

export type OpenLotCommand = Extract<Command, { type: 'OpenLot' }>;

/**
 * Decides OpenLot (R-ENG-061, R-ENG-062). Lots open one at a time in `lotOrder`;
 * `endsAt` is the command time plus the lot duration. Hard-close is derived
 * from `openedAt + hardCloseMs` by the soft close rules, so it is not echoed.
 */
export function decideOpenLot(state: AuctionState, cmd: OpenLotCommand): DecideResult {
  assertNotInPast(state, cmd);
  if (state.auctionId === null) throw new EngineError('bad_command', 'auction not created');
  if (state.closed) throw new EngineError('auction_closed');
  const lot = state.lots[cmd.lotId];
  if (lot === undefined) throw new EngineError('bad_command', 'unknown lot');
  if (lot.status === 'DONE') throw new EngineError('lot_done');
  if (lot.status === 'SETTLING') throw new EngineError('lot_frozen');
  const active = state.lotOrder.some((id) => {
    const s = state.lots[id]?.status;
    return s === 'OPEN' || s === 'CLOSING';
  });
  if (active) throw new EngineError('lot_in_progress', cmd.lotId);
  const next = state.lotOrder.find((id) => state.lots[id]?.status === 'PENDING');
  if (next !== cmd.lotId) throw new EngineError('out_of_order', cmd.lotId);
  if (lot.config === null) throw new EngineError('bad_command', 'lot has no configuration');
  return {
    events: [
      {
        type: 'LOT_OPENED',
        payload: { lotId: cmd.lotId, endsAt: cmd.at + lot.config.durationMs },
      },
    ],
    outcome: { kind: 'accepted' },
  };
}
