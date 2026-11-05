import { SeqIds, type AuctionId, type EpochMs, type RoomEvent } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { MemoryTransport } from '../src/room/memory-transport';
import { MemoryStore } from '../src/store/memory-store';
import { FlakyStore } from '../src/testing/flaky-store';

const A = new SeqIds().mint<'AuctionId'>() as AuctionId;
const ev = (seq: number): RoomEvent =>
  ({ type: 'settle_requested', auctionId: A, seq, ts: 1000 as EpochMs }) as RoomEvent;

describe('MemoryTransport (R-RT-070, R-RT-072)', () => {
  it('delivers frames in send order and records the close code', () => {
    const t = new MemoryTransport();
    for (let i = 1; i <= 20; i += 1) t.send(JSON.stringify({ t: 'x', seq: i }));
    expect(t.messages('x').map((m) => m.seq)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(t.closed).toBeUndefined();
    t.close(4401, 'expired');
    expect(t.closed).toEqual({ code: 4401, reason: 'expired' });
  });

  it('filters decoded frames by type', () => {
    const t = new MemoryTransport();
    t.send(JSON.stringify({ t: 'a' }));
    t.send(JSON.stringify({ t: 'b' }));
    expect(t.messages('b')).toEqual([{ t: 'b' }]);
    expect(t.messages()).toHaveLength(2);
  });
});

describe('FlakyStore (T-RT-110)', () => {
  it('delegates when no fault is armed', async () => {
    const s = new FlakyStore(new MemoryStore());
    await s.appendEvents(A, 0, [ev(1), ev(2)]);
    expect(await s.lastSeq(A)).toBe(2);
    expect((await s.readEvents(A, 1, 10)).map((e) => e.seq)).toEqual([1, 2]);
  });

  it('fails exactly the Nth append and stores nothing for it', async () => {
    const s = new FlakyStore(new MemoryStore());
    s.failAppend(2);
    await s.appendEvents(A, 0, [ev(1)]);
    await expect(s.appendEvents(A, 1, [ev(2)])).rejects.toThrow('append failed');
    expect(await s.lastSeq(A)).toBe(1);
    await s.appendEvents(A, 1, [ev(2)]);
    expect(await s.lastSeq(A)).toBe(2);
  });

  it('returns a conflict on demand', async () => {
    const s = new FlakyStore(new MemoryStore());
    s.failAppend(1, 'conflict');
    await expect(s.appendEvents(A, 0, [ev(1)])).rejects.toMatchObject({ code: 'conflict' });
    expect(await s.lastSeq(A)).toBe(0);
  });

  it('holds appends until released', async () => {
    const s = new FlakyStore(new MemoryStore());
    const release = s.delayAppends();
    const pending = s.appendEvents(A, 0, [ev(1)]);
    await Promise.resolve();
    expect(await s.lastSeq(A)).toBe(0);
    release();
    await pending;
    expect(await s.lastSeq(A)).toBe(1);
  });
});
