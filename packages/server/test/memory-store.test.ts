import { SeqIds, type AuctionId, type RoomEvent, type EpochMs } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/store/memory-store';

const ids = new SeqIds();
const A = ids.mint<'AuctionId'>() as AuctionId;

const ev = (seq: number, auctionId: AuctionId = A): RoomEvent =>
  ({
    type: 'settle_requested',
    auctionId,
    seq,
    ts: 1000 as EpochMs,
  }) as RoomEvent;

describe('MemoryStore contract (R-RT-090, R-RT-092)', () => {
  it('appends gaplessly and reads back in order', async () => {
    const s = new MemoryStore();
    await s.appendEvents(A, 0, [ev(1), ev(2)]);
    await s.appendEvents(A, 2, [ev(3)]);
    expect(await s.lastSeq(A)).toBe(3);
    expect((await s.readEvents(A, 2, 10)).map((e) => e.seq)).toEqual([2, 3]);
    expect(await s.readEvents(A, 1, 1)).toHaveLength(1);
  });

  it('throws conflict on a stale expectedSeq, a gap or a foreign auction', async () => {
    const s = new MemoryStore();
    await s.appendEvents(A, 0, [ev(1)]);
    await expect(s.appendEvents(A, 0, [ev(1)])).rejects.toMatchObject({ code: 'conflict' });
    await expect(s.appendEvents(A, 1, [ev(3)])).rejects.toMatchObject({ code: 'conflict' });
    const other = ids.mint<'AuctionId'>() as AuctionId;
    await expect(s.appendEvents(A, 1, [ev(2, other)])).rejects.toMatchObject({ code: 'conflict' });
    expect(await s.lastSeq(A)).toBe(1);
  });

  it('keeps an atomic batch: a bad event appends nothing', async () => {
    const s = new MemoryStore();
    await expect(s.appendEvents(A, 0, [ev(1), ev(3)])).rejects.toMatchObject({ code: 'conflict' });
    expect(await s.lastSeq(A)).toBe(0);
  });

  it('consumes a jti once until its ttl passes, and denies until a time', async () => {
    let now = 0;
    const s = new MemoryStore(() => now);
    const jti = ids.mint<'Jti'>();
    expect(await s.consumeJti(jti, 100)).toBe(true);
    expect(await s.consumeJti(jti, 100)).toBe(false);
    now = 101;
    expect(await s.consumeJti(jti, 100)).toBe(true);
    await s.denyJti(jti, 500 as EpochMs);
    expect(await s.isDenied(jti)).toBe(true);
    now = 500;
    expect(await s.isDenied(jti)).toBe(false);
  });

  it('versions the journal and snapshots', async () => {
    const s = new MemoryStore();
    expect(await s.getJournal('k')).toBeNull();
    await s.putJournal('k', 0, { a: 1 });
    await expect(s.putJournal('k', 0, { a: 2 })).rejects.toMatchObject({ code: 'conflict' });
    await s.putJournal('k', 1, { a: 2 });
    expect(await s.getJournal('k')).toEqual({ version: 2, value: { a: 2 } });
    await s.saveSnapshot(A, 5, { x: 1 });
    expect(await s.loadSnapshot(A)).toEqual({ seq: 5, state: { x: 1 } });
    await s.ping();
  });
});
