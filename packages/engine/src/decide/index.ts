import type { Command } from '../commands.js';
import { EngineError } from '../errors.js';
import { commandBody } from '../state.js';
import { LIMITS } from '../types.js';
import type { AuctionState } from '../state.js';
import { decideHammer, decideTick } from './hammer.js';
import { decideAbortLot } from './abort-lot.js';
import { decideCloseAuction } from './close-auction.js';
import { decideOpenLot } from './open-lot.js';
import { decidePlaceBid } from './place-bid.js';
import { decidePromote } from './promote.js';
import { decideRevoke } from './revoke.js';
import { decideSetup } from './setup.js';
import { decideCompleteLot, decideRecordSettlement } from './settlement.js';
import type { DecideResult } from './setup.js';

export type { DecideResult, Outcome } from './setup.js';
export { nextDeadline } from './hammer.js';

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

function assertUlid(name: string, v: unknown): void {
  if (typeof v !== 'string' || !ULID_RE.test(v)) throw new EngineError('bad_id', name);
}

/**
 * R-ENG-003, R-ENG-005: ids, time and auction id are checked for every command type
 * before any state keyed by them is read.
 */
export function assertEnvelope(state: AuctionState, cmd: Command): void {
  assertUlid('commandId', cmd.commandId);
  assertUlid('auctionId', cmd.auctionId);
  if (typeof cmd.at !== 'number' || !Number.isSafeInteger(cmd.at) || cmd.at < 0) {
    throw new EngineError('bad_time', String(cmd.at));
  }
  if (state.auctionId !== null && cmd.auctionId !== state.auctionId) {
    throw new EngineError('bad_command', 'auctionId mismatch');
  }
  switch (cmd.type) {
    case 'AddLot':
      assertUlid('lot.lotId', cmd.lot?.lotId);
      break;
    case 'RegisterBidder':
      assertUlid('bidderId', cmd.bidderId);
      if (cmd.lotId !== undefined) assertUlid('lotId', cmd.lotId);
      break;
    case 'OpenLot':
    case 'Hammer':
    case 'AbortLot':
    case 'CompleteLot':
    case 'RecordSettlement':
    case 'PromoteRunnerUp':
      assertUlid('lotId', cmd.lotId);
      break;
    case 'RevokeCeiling':
      assertUlid('bidderId', cmd.bidderId);
      break;
    default:
      break;
  }
  if (cmd.type === 'CompleteLot') assertUlid('bidderId', cmd.bidderId);
  if (cmd.type === 'AbortLot') {
    if (typeof cmd.reason !== 'string' || cmd.reason.length > LIMITS.text) {
      throw new EngineError('limit_exceeded', 'reason');
    }
    if (typeof cmd.actor !== 'string' || cmd.actor.length > LIMITS.text) {
      throw new EngineError('limit_exceeded', 'actor');
    }
  }
  if (cmd.type === 'PromoteRunnerUp') {
    assertUlid('disqualifiedBidderId', cmd.disqualifiedBidderId);
    if (typeof cmd.reason !== 'string' || cmd.reason.length > LIMITS.text) {
      throw new EngineError('limit_exceeded', 'reason');
    }
  }
  if (
    cmd.type === 'Hammer' &&
    !(typeof cmd.actor === 'string' && cmd.actor.length <= LIMITS.text)
  ) {
    throw new EngineError('limit_exceeded', 'actor');
  }
}

function route(state: AuctionState, cmd: Command): DecideResult {
  switch (cmd.type) {
    case 'CreateAuction':
    case 'AddLot':
    case 'RegisterBidder':
      return decideSetup(state, cmd);
    case 'OpenLot':
      return decideOpenLot(state, cmd);
    case 'PlaceBid':
      return decidePlaceBid(state, cmd);
    case 'Tick':
      return decideTick(state, cmd);
    case 'Hammer':
      return decideHammer(state, cmd);
    case 'RevokeCeiling':
      return decideRevoke(state, cmd);
    case 'AbortLot':
      return decideAbortLot(state, cmd);
    case 'CompleteLot':
      return decideCompleteLot(state, cmd);
    case 'RecordSettlement':
      return decideRecordSettlement(state, cmd);
    case 'PromoteRunnerUp':
      return decidePromote(state, cmd);
    case 'CloseAuction':
      return decideCloseAuction(state, cmd);
    default:
      throw new EngineError('bad_command', 'unknown command type');
  }
}

/**
 * Public decision function (R-ENG-087, R-ENG-088, R-ENG-090). Pure: it reads
 * `state` and `cmd` and returns new values only. A command id that was already
 * applied with the same body is a `duplicate` that appends nothing (the
 * original entries are in the ledger, found through `state.commands[id].seq`);
 * the same id with a different body throws `command_conflict`.
 */
export function decide(state: AuctionState, cmd: Command): DecideResult {
  assertEnvelope(state, cmd);
  const seen = state.commands[cmd.commandId];
  if (seen !== undefined) {
    if (seen.type !== null && seen.type !== cmd.type) {
      throw new EngineError('command_conflict', cmd.commandId);
    }
    if (seen.body !== null && seen.body !== commandBody(cmd)) {
      throw new EngineError('command_conflict', cmd.commandId);
    }
    const original =
      seen.rejected === null
        ? ({ kind: 'accepted' } as const)
        : ({ kind: 'rejected', reason: seen.rejected } as const);
    return { events: [], outcome: { kind: 'duplicate', original } };
  }
  return route(state, cmd);
}

/** Freezes a value and everything reachable from it; used to prove purity in tests and dev. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

/** Dev-mode `decide`: runs on deep-frozen copies so any mutation throws (R-ENG-090). */
export function decideDev(state: AuctionState, cmd: Command): DecideResult {
  const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
  return decide(deepFreeze(copy(state)), deepFreeze(copy(cmd)));
}
