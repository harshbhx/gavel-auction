import { SeqIds } from '@gavel/shared';
import type { AuctionId, EpochMs, Jti, RoomEvent, RoomStore } from '@gavel/shared';
import { describe, expect, it } from 'vitest';

/** One contract suite that every RoomStore adapter must pass (R-RT-090, R-RT-091). */
export type StoreFactory = () => RoomStore | Promise<RoomStore>;

const ids = new SeqIds();
const newAuction = (): AuctionId => ids.mint<'AuctionId'>() as AuctionId;

const ev = (auctionId: AuctionId, seq: number): RoomEvent =>
  ({ type: 'settle_requested', auctionId, seq, ts: 1000 as EpochMs }) as RoomEvent;

const batch = (auctionId: AuctionId, from: number, count: number): RoomEvent[] =>
  Array.from({ length: count }, (_, i) => ev(auctionId, from + i));

export function runStoreContract(factory: StoreFactory, name = 'adapter'): void {
  describe(`RoomStore contract: ${name} (R-RT-090, R-RT-091)`, () => {
    it('appends gaplessly and tracks lastSeq', async () => {
      const s = await factory();
      const a = newAuction();
      expect(await s.lastSeq(a)).toBe(0);
      await s.appendEvents(a, 0, batch(a, 1, 2));
      await s.appendEvents(a, 2, batch(a, 3, 1));
      expect(await s.lastSeq(a)).toBe(3);
      expect(await s.listAuctions()).toContain(a);
    });

    it('rejects a stale expectedSeq, a gap and a wrong auction with conflict', async () => {
      const s = await factory();
      const a = newAuction();
      await s.appendEvents(a, 0, batch(a, 1, 1));
      await expect(s.appendEvents(a, 0, batch(a, 1, 1))).rejects.toMatchObject({
        code: 'conflict',
      });
      await expect(s.appendEvents(a, 1, batch(a, 3, 1))).rejects.toMatchObject({
        code: 'conflict',
      });
      await expect(s.appendEvents(a, 1, batch(newAuction(), 2, 1))).rejects.toMatchObject({
        code: 'conflict',
      });
      expect(await s.lastSeq(a)).toBe(1);
    });

    it('lets exactly one of two concurrent appends win', async () => {
      const s = await factory();
      const a = newAuction();
      const results = await Promise.allSettled([
        s.appendEvents(a, 0, batch(a, 1, 1)),
        s.appendEvents(a, 0, batch(a, 1, 1)),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await s.lastSeq(a)).toBe(1);
    });

    it('reads event ranges by from and limit', async () => {
      const s = await factory();
      const a = newAuction();
      await s.appendEvents(a, 0, batch(a, 1, 5));
      expect((await s.readEvents(a, 1, 100)).map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
      expect((await s.readEvents(a, 3, 2)).map((e) => e.seq)).toEqual([3, 4]);
      expect((await s.readEvents(a, 5, 10)).map((e) => e.seq)).toEqual([5]);
      expect(await s.readEvents(a, 6, 10)).toEqual([]);
      expect(await s.readEvents(newAuction(), 1, 10)).toEqual([]);
    });

    it('saves and loads snapshots, latest wins', async () => {
      const s = await factory();
      const a = newAuction();
      expect(await s.loadSnapshot(a)).toBeNull();
      await s.appendEvents(a, 0, batch(a, 1, 5));
      await s.saveSnapshot(a, 2, { n: 1 });
      await s.saveSnapshot(a, 5, { n: 2 });
      expect(await s.loadSnapshot(a)).toEqual({ seq: 5, state: { n: 2 } });
      // An older snapshot never replaces a newer one.
      await s.saveSnapshot(a, 3, { n: 9 });
      expect(await s.loadSnapshot(a)).toEqual({ seq: 5, state: { n: 2 } });
    });

    it('consumes a jti once, atomically', async () => {
      const s = await factory();
      const jti = ids.mint<'Jti'>() as Jti;
      const results = await Promise.all([
        s.consumeJti(jti, 60_000),
        s.consumeJti(jti, 60_000),
        s.consumeJti(jti, 60_000),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await s.consumeJti(jti, 60_000)).toBe(false);
    });

    it('denies a jti until the given time', async () => {
      const s = await factory();
      const jti = ids.mint<'Jti'>() as Jti;
      expect(await s.isDenied(jti)).toBe(false);
      await s.denyJti(jti, Number.MAX_SAFE_INTEGER as EpochMs);
      expect(await s.isDenied(jti)).toBe(true);
    });

    it('versions the journal and rejects a stale version', async () => {
      const s = await factory();
      const key = `journal-${ids.mint<'AuctionId'>()}`;
      expect(await s.getJournal(key)).toBeNull();
      await s.putJournal(key, 0, { a: 1 });
      expect(await s.getJournal(key)).toEqual({ version: 1, value: { a: 1 } });
      await expect(s.putJournal(key, 0, { a: 2 })).rejects.toMatchObject({ code: 'conflict' });
      await s.putJournal(key, 1, { a: 2 });
      expect(await s.getJournal(key)).toEqual({ version: 2, value: { a: 2 } });
    });

    it('answers ping', async () => {
      const s = await factory();
      await expect(s.ping()).resolves.toBeUndefined();
    });
  });
}
