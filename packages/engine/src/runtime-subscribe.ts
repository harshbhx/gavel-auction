import type { LedgerEntry } from './events.js';
import type { Ulid } from './types.js';

type Listener = (entries: readonly LedgerEntry[]) => void;

/**
 * Fan-out of acknowledged entries to subscribers (R-ENG-103). A subscriber first
 * attaches to the live feed, then reads the stored ledger from `fromSeq`, then
 * drains what arrived meanwhile; sequence numbers drop duplicates and a jump in
 * the live feed (an append made by another writer) is filled from the store.
 */
export class SubscriptionHub {
  private readonly listeners = new Map<string, Set<Listener>>();

  /** Announces entries that the store has acknowledged. */
  publish(auctionId: Ulid, entries: readonly LedgerEntry[]): void {
    for (const l of this.listeners.get(auctionId) ?? []) l(entries);
  }

  subscribe(
    auctionId: Ulid,
    fromSeq: number,
    read: (fromSeq: number) => Promise<LedgerEntry[]>,
  ): AsyncIterable<LedgerEntry> {
    const attach = (l: Listener): (() => void) => {
      const set = this.listeners.get(auctionId) ?? new Set<Listener>();
      set.add(l);
      this.listeners.set(auctionId, set);
      return () => {
        set.delete(l);
        if (set.size === 0 && this.listeners.get(auctionId) === set) {
          this.listeners.delete(auctionId);
        }
      };
    };
    return {
      [Symbol.asyncIterator]: async function* (): AsyncGenerator<LedgerEntry, void, undefined> {
        const queue: LedgerEntry[] = [];
        let wake: (() => void) | null = null;
        const detach = attach((es) => {
          queue.push(...es);
          wake?.();
        });
        try {
          let last = Math.max(1, fromSeq) - 1;
          for (const e of await read(last + 1)) {
            if (e.seq > last) {
              last = e.seq;
              yield e;
            }
          }
          for (;;) {
            const e = queue.shift();
            if (e === undefined) {
              await new Promise<void>((resolve) => {
                wake = resolve;
              });
              wake = null;
              continue;
            }
            if (e.seq <= last) continue;
            if (e.seq > last + 1) {
              for (const g of await read(last + 1)) {
                if (g.seq > last) {
                  last = g.seq;
                  yield g;
                }
              }
              if (e.seq <= last) continue;
            }
            last = e.seq;
            yield e;
          }
        } finally {
          detach();
        }
      },
    };
  }
}
