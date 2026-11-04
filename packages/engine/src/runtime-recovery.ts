import { LedgerConflict } from './ledger/store.js';
import type { LedgerStore } from './ledger/store.js';
import type { LedgerEntry } from './events.js';
import type { Ulid } from './types.js';

/** R-ENG-101: how many times a conflicting command is retried after the first attempt. */
export const MAX_CONFLICT_RETRIES = 3;

/** How an append ended once the store's answer was understood. */
export type AppendOutcome =
  | { kind: 'appended' }
  /** The store holds a stale-head conflict: the caller must rehydrate and decide again. */
  | { kind: 'conflict' }
  /** An earlier, unacknowledged attempt of this very command is already stored. */
  | { kind: 'stored'; entries: LedgerEntry[] };

/**
 * Appends a batch and classifies the result (R-ENG-101, R-ENG-102).
 *
 * A `LedgerConflict` means nothing was written. Any other failure has an unknown
 * outcome: the store is asked for the entries after `expectedHeadSeq`, and when the
 * command id is already there the original entries are returned instead of writing
 * them again. When the head moved without our command the caller is told to
 * rehydrate; when the head did not move the original error is rethrown, because the
 * batch was not written.
 */
export async function appendRecovering(
  store: LedgerStore,
  auctionId: Ulid,
  entries: readonly LedgerEntry[],
  expectedHeadSeq: number,
  commandId: Ulid,
): Promise<AppendOutcome> {
  try {
    await store.append(auctionId, entries, expectedHeadSeq);
    return { kind: 'appended' };
  } catch (e) {
    if (e instanceof LedgerConflict) return { kind: 'conflict' };
    const stored = await findStored(store, auctionId, expectedHeadSeq, commandId);
    if (stored.length > 0) return { kind: 'stored', entries: stored };
    const head = await store.head(auctionId);
    if ((head?.seq ?? 0) !== expectedHeadSeq) return { kind: 'conflict' };
    throw e;
  }
}

/** Entries after `afterSeq` that were written for `commandId`, in order. */
export async function findStored(
  store: LedgerStore,
  auctionId: Ulid,
  afterSeq: number,
  commandId: Ulid,
): Promise<LedgerEntry[]> {
  const tail = await store.read(auctionId, afterSeq + 1);
  return tail.filter((e) => e.cmd === commandId);
}
