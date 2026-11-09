import { MAX_EXTEND_MS } from '../commands.js';
import type { Command } from '../commands.js';
import { EngineError } from '../errors.js';
import { hardCloseOf } from '../rules/softclose.js';
import type { AuctionState, LotState } from '../state.js';
import { LIMITS } from '../types.js';
import { assertNotInPast } from './setup.js';
import type { DecideResult } from './setup.js';

export type PauseLotCommand = Extract<Command, { type: 'PauseLot' }>;
export type ResumeLotCommand = Extract<Command, { type: 'ResumeLot' }>;
export type ExtendLotCommand = Extract<Command, { type: 'ExtendLot' }>;

/** The lot a clock command targets: it must exist and be OPEN with a running or paused clock. */
function clockLot(
  state: AuctionState,
  cmd: PauseLotCommand | ResumeLotCommand | ExtendLotCommand,
): LotState & { endsAt: number } {
  assertNotInPast(state, cmd);
  if (state.auctionId === null) throw new EngineError('bad_command', 'auction not created');
  if (state.closed) throw new EngineError('auction_closed');
  if (cmd.actor.length > LIMITS.text) throw new EngineError('limit_exceeded', 'actor');
  const lot = state.lots[cmd.lotId];
  if (lot === undefined) throw new EngineError('bad_command', 'unknown lot');
  if (lot.status === 'DONE') throw new EngineError('lot_done');
  if (lot.status === 'SETTLING') throw new EngineError('lot_frozen');
  if (lot.status !== 'OPEN' || lot.endsAt === null)
    throw new EngineError('lot_not_open', lot.status);
  return lot as LotState & { endsAt: number };
}

/**
 * Decides PauseLot (RT-18): freezes the clock of an OPEN lot. The time left is recorded so
 * ResumeLot can restore it; Tick does nothing and bids are rejected while paused. A lot whose
 * deadline has already passed cannot be paused (a Tick closes it).
 */
export function decidePauseLot(state: AuctionState, cmd: PauseLotCommand): DecideResult {
  const lot = clockLot(state, cmd);
  if (lot.pausedRemainingMs !== undefined) throw new EngineError('bad_command', 'already paused');
  if (cmd.at >= lot.endsAt) throw new EngineError('lot_not_open', 'deadline passed');
  return {
    events: [
      {
        type: 'LOT_PAUSED',
        payload: { lotId: cmd.lotId, actor: cmd.actor, remainingMs: cmd.at - lot.endsAt },
      },
    ],
    outcome: { kind: 'accepted' },
  };
}

/**
 * Decides ResumeLot (RT-18): the deadline becomes the resume time plus the time left at pause.
 * The hard close moves by the same paused time (evolve adds it to `pausedTotalMs`), so the new
 * deadline never passes it (R-ENG-036, R12-E08).
 */
export function decideResumeLot(state: AuctionState, cmd: ResumeLotCommand): DecideResult {
  const lot = clockLot(state, cmd);
  if (lot.pausedRemainingMs === undefined) throw new EngineError('bad_command', 'not paused');
  return {
    events: [
      {
        type: 'LOT_RESUMED',
        payload: {
          lotId: cmd.lotId,
          actor: cmd.actor,
          endsAtBefore: lot.endsAt,
          endsAtAfter: cmd.at + lot.pausedRemainingMs,
        },
      },
    ],
    outcome: { kind: 'accepted' },
  };
}

/**
 * Decides ExtendLot (RT-18): an auctioneer adds time to a running lot. It does not count toward
 * the soft-close extension limit. A paused lot is resumed first; a lot past its deadline is closed
 * by Tick instead. `extraMs` is checked here too, not only by `parseCommand`, and the new
 * deadline may not pass the hard close (R-ENG-036, R12-E08).
 */
export function decideExtendLot(state: AuctionState, cmd: ExtendLotCommand): DecideResult {
  const lot = clockLot(state, cmd);
  if (cmd.reason.length > LIMITS.text) throw new EngineError('limit_exceeded', 'reason');
  if (!Number.isSafeInteger(cmd.extraMs) || cmd.extraMs < 1 || cmd.extraMs > MAX_EXTEND_MS) {
    throw new EngineError('bad_command', `extraMs must be an integer in 1..${MAX_EXTEND_MS}`);
  }
  if (lot.pausedRemainingMs !== undefined) throw new EngineError('bad_command', 'resume first');
  if (cmd.at >= lot.endsAt) throw new EngineError('lot_not_open', 'deadline passed');
  const hard = hardCloseOf(lot);
  if (hard !== null && lot.endsAt + cmd.extraMs > hard) {
    throw new EngineError('bad_command', `extension passes the hard close at ${hard}`);
  }
  return {
    events: [
      {
        type: 'LOT_EXTENDED',
        payload: {
          lotId: cmd.lotId,
          actor: cmd.actor,
          reason: cmd.reason,
          extraMs: cmd.extraMs,
          endsAtBefore: lot.endsAt,
          endsAtAfter: lot.endsAt + cmd.extraMs,
        },
      },
    ],
    outcome: { kind: 'accepted' },
  };
}
