import { SeqIds, type AuctionId, type EpochMs, type RoomEvent } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { exportLines } from '../src/http/export';
import { MemoryStore } from '../src/store/memory-store';

const A = new SeqIds().mint<'AuctionId'>() as AuctionId;

const ev = (seq: number): RoomEvent =>
  ({ type: 'settle_requested', auctionId: A, seq, ts: 1000 as EpochMs }) as RoomEvent;

describe('event immutability and export (T-RT-071, R-RT-097)', () => {
  it('exposes no update or delete surface for event rows', () => {
    const s = new MemoryStore();
    const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(s) as object);
    const names = [...proto, ...Object.keys(s)];
    const writers = names.filter(
      (n) => /^(update|delete|remove|truncate|rewrite|edit)/i.test(n) && !/jti/i.test(n),
    );
    expect(writers).toEqual([]);
  });

  it('streams seq 1..n in order across page boundaries', async () => {
    const s = new MemoryStore();
    const n = 1203;
    await s.appendEvents(
      A,
      0,
      Array.from({ length: n }, (_, i) => ev(i + 1)),
    );
    const seqs: number[] = [];
    for await (const line of exportLines(s, A, 'admin')) {
      seqs.push((JSON.parse(line) as { seq: number }).seq);
    }
    expect(seqs).toEqual(Array.from({ length: n }, (_, i) => i + 1));
  });
});
