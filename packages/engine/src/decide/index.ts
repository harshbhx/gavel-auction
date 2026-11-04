import type { Command } from '../commands.js';
import { EngineError } from '../errors.js';
import { commandBody } from '../state.js';
import type { AuctionState } from '../state.js';
import { decideHammer, decideTick } from './hammer.js';
import { decideOpenLot } from './open-lot.js';
import { decidePlaceBid } from './place-bid.js';
import { decideSetup } from './setup.js';
import type { DecideResult } from './setup.js';

export type { DecideResult, Outcome } from './setup.js';
export { nextDeadline } from './hammer.js';

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
    case 'PromoteRunnerUp':
    case 'CompleteLot':
    case 'RecordSettlement':
    case 'CloseAuction':
      throw new EngineError('bad_command', `${cmd.type} is not supported yet`);
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
  const seen = state.commands[cmd.commandId];
  if (seen !== undefined) {
    if (seen.body !== null && seen.body !== commandBody(cmd)) {
      throw new EngineError('command_conflict', cmd.commandId);
    }
    return { events: [], outcome: { kind: 'duplicate' } };
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
