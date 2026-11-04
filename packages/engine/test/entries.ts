import type { LedgerEntry, LedgerEvent } from '../src/events.js';
import type { Ulid } from '../src/types.js';

/** Test helper: wraps events into unsealed-looking entries with sequential seq and fixed hashes. */
export function entriesFrom(
  events: Array<{ event: LedgerEvent; at: number; cmd?: string | null }>,
  auctionId = 'AUCTION' as Ulid,
): LedgerEntry[] {
  return events.map(({ event, at, cmd }, i) => ({
    v: 1,
    auctionId,
    seq: i + 1,
    at,
    type: event.type,
    cmd: (cmd ?? null) as Ulid | null,
    payload: event.payload,
    prev: `p${i}`,
    hash: `h${i + 1}`,
  })) as unknown as LedgerEntry[];
}
