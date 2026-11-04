import type { Command } from '../commands.js';
import { EngineError, InvariantError } from '../errors.js';
import { SETTLEMENT_STATES } from '../events.js';
import { bidderFor, scopeKey } from '../rules/exposure.js';
import type { AuctionState, LotState } from '../state.js';
import { LIMITS } from '../types.js';
import { assertNotInPast } from './setup.js';
import type { DecideResult } from './setup.js';

export type CompleteLotCommand = Extract<Command, { type: 'CompleteLot' }>;
export type RecordSettlementCommand = Extract<Command, { type: 'RecordSettlement' }>;

/**
 * A lot that was hammered and not yet settled; DONE lots accept nothing (R-ENG-068).
 * The terminal settlement state is not a command: evolve sets it from LOT_SETTLED
 * (SETTLED) and from a LOT_UNSOLD that follows a hammer (VOIDING).
 */
function settlingLot(state: AuctionState, lotId: string): LotState {
  if (state.auctionId === null) throw new EngineError('bad_command', 'auction not created');
  if (state.closed) throw new EngineError('auction_closed');
  const lot = state.lots[lotId];
  if (lot === undefined) throw new EngineError('bad_command', 'unknown lot');
  if (lot.status === 'DONE') throw new EngineError('lot_done');
  if (lot.status !== 'SETTLING') throw new EngineError('bad_command', `lot is ${lot.status}`);
  return lot;
}

/** Captured cents already recorded for a bidder within one holdScope key. */
function capturedIn(state: AuctionState, bidderId: string, key: string): number {
  let sum = 0;
  for (const lot of Object.values(state.lots)) {
    if (lot.winnerId !== bidderId || lot.capturedCents === null) continue;
    if (scopeKey(state, lot.lotId) === key) sum += lot.capturedCents;
  }
  return sum;
}

/**
 * Decides CompleteLot (R-ENG-066, R-ENG-069): the capture must be booked to the
 * lot's current winner, the captured amount must equal the hammer or promoted price, and the bidder's captured total must fit the ceiling.
 */
export function decideCompleteLot(state: AuctionState, cmd: CompleteLotCommand): DecideResult {
  assertNotInPast(state, cmd);
  const lot = settlingLot(state, cmd.lotId);
  if (cmd.ref.length > LIMITS.text) throw new EngineError('limit_exceeded', 'ref');
  if (lot.winnerId === null || lot.priceCents === null) {
    throw new EngineError('bad_command', 'lot has no winner');
  }
  if (cmd.bidderId !== lot.winnerId) {
    throw new EngineError('not_current_winner', `${cmd.bidderId} != ${lot.winnerId}`);
  }
  if (cmd.capturedCents !== lot.priceCents) {
    throw new EngineError('capture_mismatch', `${cmd.capturedCents} != ${lot.priceCents}`);
  }
  const ceiling = bidderFor(state, lot.winnerId, lot.lotId)?.ceilingCents ?? 0;
  const total = capturedIn(state, lot.winnerId, scopeKey(state, lot.lotId)) + cmd.capturedCents;
  if (total > ceiling) {
    throw new InvariantError(
      'captured_over_ceiling',
      `captured ${total} exceeds ceiling ${ceiling}`,
    );
  }
  return {
    events: [
      {
        type: 'LOT_SETTLED',
        payload: {
          lotId: cmd.lotId,
          winnerId: lot.winnerId,
          capturedCents: cmd.capturedCents,
          ref: cmd.ref,
        },
      },
    ],
    outcome: { kind: 'accepted' },
  };
}

/**
 * Decides RecordSettlement (R-ENG-067): `to` is one of the fixed states and `from`
 * is the lot's last recorded state. The transition graph belongs to payments.
 */
export function decideRecordSettlement(
  state: AuctionState,
  cmd: RecordSettlementCommand,
): DecideResult {
  assertNotInPast(state, cmd);
  const lot = settlingLot(state, cmd.lotId);
  if (cmd.ref.length > LIMITS.text) throw new EngineError('limit_exceeded', 'ref');
  const known: readonly string[] = SETTLEMENT_STATES;
  if (!known.includes(cmd.to) || !known.includes(cmd.from)) {
    throw new EngineError('bad_command', 'unknown settlement state');
  }
  if (cmd.from !== lot.settlement) {
    throw new EngineError('state_continuity', `${cmd.from} != ${lot.settlement}`);
  }
  return {
    events: [
      {
        type: 'SETTLEMENT_STATE',
        payload: { lotId: cmd.lotId, from: cmd.from, to: cmd.to, ref: cmd.ref },
      },
    ],
    outcome: { kind: 'accepted' },
  };
}
