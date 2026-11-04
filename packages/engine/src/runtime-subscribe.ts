import type { LedgerEntry } from './events.js';
import type { Ulid } from './types.js';

/** A subscriber fell too far behind and was dropped; reconnect from the last seq seen. */
export class SubscriberOverflow extends Error {
  constructor(readonly limit: number) {
    super(`subscriber is more than ${limit} entries behind`);
    this.name = 'SubscriberOverflow';
  }
}

export const DEFAULT_MAX_QUEUE = 10_000;

type Listener = (entries: readonly LedgerEntry[]) => void;

/**
 * Fan-out of acknowledged entries to subscribers (R-ENG-103). A subscriber first
 * attaches to the live feed, then reads the stored ledger from `fromSeq`, then
 * drains what arrived meanwhile; sequence numbers drop duplicates and a jump in
 * the live feed (an append made by another writer) is filled from the store.
 */
export class SubscriptionHub {
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(private readonly maxQueue: number = DEFAULT_MAX_QUEUE) {}

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
    const maxQueue = this.maxQueue;
    return {
      [Symbol.asyncIterator]: async function* (): AsyncGenerator<LedgerEntry, void, undefined> {
        const queue: LedgerEntry[] = [];
        let wake: (() => void) | null = null;
        let overflowed = false;
        const detach = attach((es) => {
          if (overflowed) return;
          if (queue.length + es.length > maxQueue) {
            // A reader that stopped draining must not grow memory without bound.
            overflowed = true;
            queue.length = 0;
            detach();
          } else {
            queue.push(...es);
          }
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
            if (overflowed) throw new SubscriberOverflow(maxQueue);
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
