/** Public entry point of @gavel/engine: the pure decide/evolve core, ledger and replay. */
export { decide } from './decide/index.js';
export type { DecideResult, Outcome } from './decide/index.js';
export { evolve, evolveAll } from './evolve.js';
export { initialState, commandBody, entryBody } from './state.js';
export type { AuctionState, LotState, BidderState, SeenCommand } from './state.js';
export { parseCommand, COMMAND_TYPES } from './commands.js';
export type { Command, CommandType } from './commands.js';
export { LEDGER_EVENT_TYPES } from './events.js';
export type { LedgerEntry, LedgerEvent, BidAudit } from './events.js';
export { REJECT_REASONS } from './reasons.js';
export type { RejectReason } from './reasons.js';
export { EngineError, ENGINE_ERROR_CODES } from './errors.js';
export type { EngineErrorCode } from './errors.js';
export { ChainError, replay, stateDigest } from './replay.js';
export { GENESIS_PREV, genesisHead, headOf, sealBatch, verifyChain } from './ledger/chain.js';
export type { ChainHead, VerifyFailure, VerifyResult } from './ledger/chain.js';
export { LedgerConflict } from './ledger/store.js';
export type { LedgerStore } from './ledger/store.js';
export { InMemoryLedgerStore } from './ledger/memory-store.js';
export { canonicalize } from './canonical.js';
export { validateAuctionConfig, validateLotConfig, DEFAULT_AUCTION_CONFIG } from './config.js';
export { LIMITS, MAX_AMOUNT_CENTS } from './types.js';
export type {
  AuctionConfig,
  BidSource,
  IncrementRule,
  LotConfig,
  LotStatus,
  Mode,
  SoftClose,
  Ulid,
} from './types.js';
export { CEILING_PRESETS_CENTS, MIN_CEILING_CENTS, DEFAULT_MAX_CEILING_CENTS } from './policy.js';
