import type { Command } from '../commands.js';
import { validateAuctionConfig, validateLotConfig, validateRegisterScope } from '../config.js';
import type { ConfigError } from '../config.js';
import { ENGINE_ERROR_CODES, EngineError } from '../errors.js';
import type { LedgerEvent } from '../events.js';
import { checkCeiling } from '../policy.js';
import type { RejectReason } from '../reasons.js';
import { bidderKey } from '../state.js';
import type { AuctionState } from '../state.js';
import { LIMITS } from '../types.js';

export type Outcome =
  | { kind: 'accepted' }
  | { kind: 'rejected'; reason: RejectReason }
  | { kind: 'noop' }
  | {
      kind: 'duplicate';
      original: { kind: 'accepted' } | { kind: 'rejected'; reason: RejectReason };
    };

export interface DecideResult {
  events: LedgerEvent[];
  outcome: Outcome;
}

export type SetupCommand = Extract<
  Command,
  { type: 'CreateAuction' | 'AddLot' | 'RegisterBidder' }
>;

const accepted = (events: LedgerEvent[]): DecideResult => ({
  events,
  outcome: { kind: 'accepted' },
});

/** R-ENG-004: a command older than the ledger head fails and appends nothing. */
export function assertNotInPast(state: AuctionState, cmd: { at: number }): void {
  if (cmd.at < state.head.at) {
    throw new EngineError('time_regression', `${cmd.at} < ${state.head.at}`);
  }
}

function configFailure(errors: readonly ConfigError[]): never {
  const first = errors[0];
  const known = ENGINE_ERROR_CODES as readonly string[];
  if (first !== undefined && known.includes(first.code)) {
    throw new EngineError(first.code as (typeof ENGINE_ERROR_CODES)[number], first.path);
  }
  throw new EngineError(
    'bad_command',
    first === undefined ? '' : `${first.path}: ${first.message}`,
  );
}

function assertAuctionOpen(state: AuctionState): void {
  if (state.auctionId === null) throw new EngineError('bad_command', 'auction not created');
  if (state.closed) throw new EngineError('auction_closed');
}

/** Decides CreateAuction, AddLot and RegisterBidder (R-ENG-015, R-ENG-040, R-ENG-041). */
export function decideSetup(state: AuctionState, cmd: SetupCommand): DecideResult {
  assertNotInPast(state, cmd);
  switch (cmd.type) {
    case 'CreateAuction': {
      if (state.auctionId !== null) throw new EngineError('bad_command', 'auction exists');
      if (cmd.title.length === 0 || cmd.title.length > LIMITS.title) {
        throw new EngineError('limit_exceeded', 'title');
      }
      const v = validateAuctionConfig(cmd.config);
      if (!v.ok) return configFailure(v.errors);
      return accepted([
        { type: 'AUCTION_CREATED', payload: { title: cmd.title, config: cmd.config } },
      ]);
    }
    case 'AddLot': {
      assertAuctionOpen(state);
      const existing = state.lots[cmd.lot.lotId];
      if (existing !== undefined) {
        throw new EngineError(existing.status === 'PENDING' ? 'bad_command' : 'lot_frozen');
      }
      if (state.lotOrder.length >= LIMITS.lots) throw new EngineError('limit_exceeded', 'lots');
      const v = validateLotConfig(cmd.lot);
      if (!v.ok) return configFailure(v.errors);
      if (v.value.reserveCents > state.config.maxCeilingCents) {
        throw new EngineError('bad_command', 'reserve above maxCeilingCents');
      }
      return accepted([{ type: 'LOT_ADDED', payload: { lotId: v.value.lotId, lot: v.value } }]);
    }
    case 'RegisterBidder': {
      assertAuctionOpen(state);
      const scope = validateRegisterScope(state.config.holdScope, cmd);
      if (!scope.ok) return configFailure(scope.errors);
      if (cmd.lotId !== undefined && state.lots[cmd.lotId] === undefined) {
        throw new EngineError('bad_command', 'unknown lot');
      }
      if (checkCeiling(cmd.ceilingCents, state.config.maxCeilingCents) !== 'ok') {
        throw new EngineError('bad_ceiling', String(cmd.ceilingCents));
      }
      if (cmd.holdRef !== undefined && cmd.holdRef.length > LIMITS.holdRef) {
        throw new EngineError('limit_exceeded', 'holdRef');
      }
      const existing = state.bidders[bidderKey(cmd.bidderId, cmd.lotId)];
      if (existing !== undefined) {
        if (cmd.ceilingCents <= existing.ceilingCents) {
          throw new EngineError('cannot_lower_ceiling', String(cmd.ceilingCents));
        }
        // A larger ceiling needs a larger authorisation: a raise on a held bidder must say which.
        if (existing.holdRef !== null && cmd.holdRef === undefined) {
          throw new EngineError('bad_command', 'holdRef required to raise a held ceiling');
        }
        const payload: Extract<LedgerEvent, { type: 'CEILING_RAISED' }>['payload'] = {
          bidderId: cmd.bidderId,
          fromCents: existing.ceilingCents,
          ceilingCents: cmd.ceilingCents,
        };
        if (cmd.holdRef !== undefined) payload.holdRef = cmd.holdRef;
        if (cmd.lotId !== undefined) payload.lotId = cmd.lotId;
        return accepted([{ type: 'CEILING_RAISED', payload }]);
      }
      const known = new Set(Object.values(state.bidders).map((b) => b.bidderId));
      if (known.size >= LIMITS.bidders) throw new EngineError('limit_exceeded', 'bidders');
      const payload: Extract<LedgerEvent, { type: 'BIDDER_REGISTERED' }>['payload'] = {
        bidderId: cmd.bidderId,
        ceilingCents: cmd.ceilingCents,
      };
      if (cmd.holdRef !== undefined) payload.holdRef = cmd.holdRef;
      if (cmd.lotId !== undefined) payload.lotId = cmd.lotId;
      return accepted([{ type: 'BIDDER_REGISTERED', payload }]);
    }
  }
}
