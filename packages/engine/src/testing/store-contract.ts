import { describe, expect, it } from 'vitest';
import { GENESIS_PREV } from '../ledger/chain.js';
import { LedgerConflict } from '../ledger/store.js';
import type { LedgerStore } from '../ledger/store.js';
import type { LedgerEntry } from '../events.js';
import type { Ulid } from '../types.js';

const ULID_PAD = '0'.repeat(26);
const auction = (n: number): Ulid => `${ULID_PAD}${n}`.slice(-26) as Ulid;

/** A syntactically valid entry; the store never verifies the hash chain, only contiguity. */
function entry(auctionId: Ulid, seq: number, prev: string): LedgerEntry {
  return {
    v: 1,
    auctionId,
    seq,
    at: seq,
    type: 'LOT_ADDED',
    cmd: null,
    payload: { lotId: auctionId },
    prev,
    hash: `h${seq}`.padEnd(64, '0'),
  };
}

/** `count` chained entries that start after `afterSeq`, whose last hash is `afterHash`. */
function batch(auctionId: Ulid, afterSeq: number, afterHash: string, count: number): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  let prev = afterHash;
  for (let i = 1; i <= count; i++) {
    const e = entry(auctionId, afterSeq + i, prev);
    out.push(e);
    prev = e.hash;
  }
  return out;
}

/**
 * Behaviour every LedgerStore adapter must have (R-ENG-104): ordered reads, head,
 * conflict on a stale `expectedHeadSeq`, all-or-nothing batches, large batches.
 * Registers vitest cases; call it inside a test file with a factory that returns a
 * fresh, empty store.
 */
export function runStoreContract(makeStore: () => Promise<LedgerStore>): void {
  describe('LedgerStore contract', () => {
    it('R-ENG-104 an unknown auction has no head and no entries', async () => {
      const store = await makeStore();
      expect(await store.head(auction(1))).toBeNull();
      expect(await store.read(auction(1), 1)).toEqual([]);
    });

    it('R-ENG-104 reads return entries in seq order from the requested seq', async () => {
      const store = await makeStore();
      const a = auction(1);
      const first = batch(a, 0, GENESIS_PREV, 3);
      await store.append(a, first, 0);
      const last = first[2];
      if (last === undefined) throw new Error('batch missing');
      await store.append(a, batch(a, 3, last.hash, 2), 3);
      const all = await store.read(a, 1);
      expect(all.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
      expect((await store.read(a, 4)).map((e) => e.seq)).toEqual([4, 5]);
      expect(await store.read(a, 6)).toEqual([]);
    });

    it('R-ENG-104 head reports the last seq and hash', async () => {
      const store = await makeStore();
      const a = auction(1);
      const entries = batch(a, 0, GENESIS_PREV, 4);
      await store.append(a, entries, 0);
      const last = entries[3];
      expect(await store.head(a)).toEqual({ seq: 4, hash: last?.hash });
    });

    it('R-ENG-104 a stale expectedHeadSeq fails with LedgerConflict and writes nothing', async () => {
      const store = await makeStore();
      const a = auction(1);
      const first = batch(a, 0, GENESIS_PREV, 2);
      await store.append(a, first, 0);
      const stale = batch(a, 0, GENESIS_PREV, 1);
      await expect(store.append(a, stale, 0)).rejects.toBeInstanceOf(LedgerConflict);
      const ahead = batch(a, 5, 'x', 1);
      await expect(store.append(a, ahead, 5)).rejects.toBeInstanceOf(LedgerConflict);
      expect((await store.read(a, 1)).map((e) => e.seq)).toEqual([1, 2]);
    });

    it('R-ENG-076 a rejected batch leaves none of its entries behind', async () => {
      const store = await makeStore();
      const a = auction(1);
      const good = batch(a, 0, GENESIS_PREV, 3);
      const broken = [good[0], good[2]].filter((e): e is LedgerEntry => e !== undefined);
      await expect(store.append(a, broken, 0)).rejects.toThrow();
      expect(await store.head(a)).toBeNull();
      expect(await store.read(a, 1)).toEqual([]);
      await store.append(a, good, 0);
      expect((await store.read(a, 1)).length).toBe(3);
    });

    it('R-ENG-104 auctions are independent', async () => {
      const store = await makeStore();
      await store.append(auction(1), batch(auction(1), 0, GENESIS_PREV, 2), 0);
      await store.append(auction(2), batch(auction(2), 0, GENESIS_PREV, 1), 0);
      expect((await store.head(auction(1)))?.seq).toBe(2);
      expect((await store.head(auction(2)))?.seq).toBe(1);
    });

    it('R-ENG-104 a large batch is stored whole and read back in order', async () => {
      const store = await makeStore();
      const a = auction(1);
      const big = batch(a, 0, GENESIS_PREV, 1000);
      await store.append(a, big, 0);
      const back = await store.read(a, 1);
      expect(back.length).toBe(1000);
      expect(back.every((e, i) => e.seq === i + 1)).toBe(true);
      expect((await store.head(a))?.seq).toBe(1000);
    });
  });
}
