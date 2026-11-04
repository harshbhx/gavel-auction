import type { LedgerEntry } from '../events.js';
import type { Ulid } from '../types.js';

/** Raised by `append` when `expectedHeadSeq` does not match the stored head (R-ENG-104). */
export class LedgerConflict extends Error {
  readonly expectedHeadSeq: number;
  readonly actualHeadSeq: number;
  constructor(expectedHeadSeq: number, actualHeadSeq: number) {
    super(`ledger conflict: expected head seq ${expectedHeadSeq}, found ${actualHeadSeq}`);
    this.name = 'LedgerConflict';
    this.expectedHeadSeq = expectedHeadSeq;
    this.actualHeadSeq = actualHeadSeq;
  }
}

/**
 * Persistence seam implemented by the server. `append` persists the whole
 * batch or nothing (R-ENG-076) and fails with LedgerConflict on a stale head.
 */
export interface LedgerStore {
  append(auctionId: Ulid, entries: readonly LedgerEntry[], expectedHeadSeq: number): Promise<void>;
  read(auctionId: Ulid, fromSeq: number): Promise<LedgerEntry[]>;
  head(auctionId: Ulid): Promise<{ seq: number; hash: string } | null>;
}
