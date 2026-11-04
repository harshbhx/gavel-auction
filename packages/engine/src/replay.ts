import { canonicalBytes } from './canonical.js';
import type { JsonValue } from './canonical.js';
import { verifyChain } from './ledger/chain.js';
import type { VerifyFailure } from './ledger/chain.js';
import { evolve } from './evolve.js';
import type { LedgerEntry } from './events.js';
import { pureHasher } from './sha256.js';
import type { Hasher } from './hasher.js';
import { initialState } from './state.js';
import type { AuctionState } from './state.js';

/** Raised when a ledger fails verification; no state is built (R-ENG-094). */
export class ChainError extends Error {
  readonly firstBadIndex: number;
  readonly reason: VerifyFailure;
  constructor(firstBadIndex: number, reason: VerifyFailure) {
    super(`chain_error: ${reason} at index ${firstBadIndex}`);
    this.name = 'ChainError';
    this.firstBadIndex = firstBadIndex;
    this.reason = reason;
  }
}

/** SHA-256 of the canonical JSON of the whole state (R-ENG-093). */
export function stateDigest(state: AuctionState, hasher: Hasher = pureHasher): string {
  return hasher.sha256Hex(canonicalBytes(state as unknown as JsonValue));
}

/** Verifies the chain first, then reduces the entries with `evolve` (R-ENG-092, R-ENG-094). */
export function replay(entries: readonly LedgerEntry[], hasher: Hasher = pureHasher): AuctionState {
  const v = verifyChain(entries, { hasher });
  if (!v.ok) throw new ChainError(v.firstBadIndex, v.reason);
  return entries.reduce(evolve, initialState);
}
