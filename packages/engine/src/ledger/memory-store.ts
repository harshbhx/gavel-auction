import type { LedgerEntry } from '../events.js';
import type { Ulid } from '../types.js';
import { LedgerConflict } from './store.js';
import type { LedgerStore } from './store.js';

/** In-memory LedgerStore for tests and the demo. */
export class InMemoryLedgerStore implements LedgerStore {
  private readonly ledgers = new Map<string, LedgerEntry[]>();

  append(auctionId: Ulid, entries: readonly LedgerEntry[], expectedHeadSeq: number): Promise<void> {
    const cur = this.ledgers.get(auctionId) ?? [];
    if (cur.length !== expectedHeadSeq) {
      return Promise.reject(new LedgerConflict(expectedHeadSeq, cur.length));
    }
    const gap = entries.findIndex((e, i) => e.seq !== expectedHeadSeq + i + 1);
    if (gap >= 0) return Promise.reject(new RangeError(`entry at index ${gap} is not contiguous`));
    this.ledgers.set(auctionId, [...cur, ...entries]);
    return Promise.resolve();
  }

  read(auctionId: Ulid, fromSeq: number): Promise<LedgerEntry[]> {
    const cur = this.ledgers.get(auctionId) ?? [];
    return Promise.resolve(cur.filter((e) => e.seq >= fromSeq));
  }

  head(auctionId: Ulid): Promise<{ seq: number; hash: string } | null> {
    const last = (this.ledgers.get(auctionId) ?? []).at(-1);
    return Promise.resolve(last === undefined ? null : { seq: last.seq, hash: last.hash });
  }
}
