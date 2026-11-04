import { describe, expect, it } from 'vitest';
import type { LedgerEntry, LedgerEvent } from '../src/events.js';
import { GENESIS_PREV, genesisHead, headOf, sealBatch, verifyChain } from '../src/ledger/chain.js';
import { InMemoryLedgerStore } from '../src/ledger/memory-store.js';
import { LedgerConflict } from '../src/ledger/store.js';
import type { Ulid } from '../src/types.js';

const A = '01JC0000000000000000000001' as Ulid;
const C1 = '01JC0000000000000000000A01' as Ulid;
const C2 = '01JC0000000000000000000A02' as Ulid;
const LOT = '01JC0000000000000000000M01' as Ulid;

function build(n: number): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  for (let i = 0; i < n; i++) {
    const ev: LedgerEvent =
      i === 0
        ? { type: 'AUCTION_CREATED', payload: { title: 'Gala', config: {} } }
        : { type: 'LOT_CLOSING', payload: { lotId: LOT, reason: 'deadline' } };
    const head =
      out.length === 0
        ? genesisHead(A)
        : { auctionId: A, seq: out.length, hash: (out[out.length - 1] as LedgerEntry).hash };
    out.push(...sealBatch([ev], head, 1000 + i, C1));
  }
  return out;
}

const clone = (e: readonly LedgerEntry[]): LedgerEntry[] =>
  JSON.parse(JSON.stringify(e)) as LedgerEntry[];

describe('chain', () => {
  it('T-ENG-052 (R-ENG-072, R-ENG-070, R-ENG-071): golden vector', () => {
    const e1 = sealBatch(
      [
        {
          type: 'AUCTION_CREATED',
          payload: { title: 'Spring Gala', config: { currency: 'USD', holdScope: 'event' } },
        },
      ],
      genesisHead(A),
      1788000000000,
      C1,
    );
    expect(e1[0]?.prev).toBe(GENESIS_PREV);
    expect(e1[0]?.hash).toBe('e1d36276c41c5b7d87c45b87dd29d4d1432dcdadced3035f1a8dfc0486045540');
    const e2 = sealBatch(
      [{ type: 'LOT_ADDED', payload: { lotId: '01JC0000000000000000000L01' as Ulid } }],
      { auctionId: A, seq: 1, hash: e1[0]?.hash ?? '' },
      1788000001000,
      C2,
    );
    expect(e2[0]?.hash).toBe('f685ed77a83bf8dde536e1f3ffc999879451cb2c1052c15d9ccd4b30929a5b13');
  });

  it('T-ENG-055 (R-ENG-073): seq gaps and duplicates are bad_seq, decreasing at is bad_time', () => {
    const l = build(5);
    expect(verifyChain(l)).toMatchObject({ ok: true, count: 5 });
    expect(verifyChain([l[0], l[2]] as LedgerEntry[])).toMatchObject({
      ok: false,
      reason: 'bad_seq',
    });
    expect(verifyChain([l[0], l[0]] as LedgerEntry[])).toMatchObject({
      ok: false,
      reason: 'bad_seq',
    });
    const batch = sealBatch(
      [{ type: 'LOT_CLOSING', payload: { lotId: LOT, reason: 'early' } }],
      { auctionId: A, seq: 1, hash: (l[0] as LedgerEntry).hash },
      500,
      C1,
    );
    expect(verifyChain([l[0], batch[0]] as LedgerEntry[])).toMatchObject({
      ok: false,
      firstBadIndex: 1,
      reason: 'bad_time',
    });
  });

  it('T-ENG-056 (R-ENG-074, R-ENG-080): each mutation is located', () => {
    const l = build(40);
    for (let i = 0; i < l.length; i++) {
      const muts: Array<[string, (e: Record<string, unknown>) => void, string]> = [
        [
          'payload',
          (e) => ((e['payload'] as Record<string, unknown>)['reason'] = 'early'),
          'bad_hash',
        ],
        ['at', (e) => (e['at'] = (e['at'] as number) + 1), 'bad_hash'],
        ['type', (e) => (e['type'] = 'LOT_UNSOLD'), 'bad_hash'],
        ['prev', (e) => (e['prev'] = 'f'.repeat(64)), 'bad_prev'],
        ['hash', (e) => (e['hash'] = 'f'.repeat(64)), 'bad_hash'],
        ['v', (e) => (e['v'] = 2), 'unsupported_version'],
      ];
      for (const [name, mut, reason] of muts) {
        const c = clone(l);
        mut(c[i] as unknown as Record<string, unknown>);
        const r = verifyChain(c);
        expect(r.ok, name).toBe(false);
        if (!r.ok) {
          expect(r.firstBadIndex, name).toBe(i);
          expect(r.reason, name).toBe(reason);
        }
      }
    }
  });

  it('T-ENG-057 (R-ENG-074): delete, swap, duplicate and truncate', () => {
    const l = build(10);
    const head = headOf(l);
    const del = l.filter((_, i) => i !== 4);
    expect(verifyChain(del)).toMatchObject({ ok: false, firstBadIndex: 4 });
    const swapped = [...l];
    swapped[2] = l[3] as LedgerEntry;
    swapped[3] = l[2] as LedgerEntry;
    expect(verifyChain(swapped)).toMatchObject({ ok: false, firstBadIndex: 2 });
    const dup = [...l.slice(0, 5), l[4] as LedgerEntry, ...l.slice(5)];
    expect(verifyChain(dup)).toMatchObject({ ok: false, firstBadIndex: 5 });
    const cut = l.slice(0, 7);
    expect(verifyChain(cut).ok).toBe(true);
    expect(verifyChain(cut, { expectedHead: head ?? undefined })).toMatchObject({
      ok: false,
      reason: 'truncated',
    });
  });

  it('ENG-RT-09: genesis must be AUCTION_CREATED and the auction id must not change', () => {
    const l = build(3);
    const notGenesis = sealBatch(
      [{ type: 'LOT_CLOSING', payload: { lotId: LOT, reason: 'deadline' } }],
      genesisHead(A),
      1000,
      C1,
    );
    expect(verifyChain(notGenesis)).toMatchObject({ ok: false, reason: 'bad_genesis' });
    const other = '01JC0000000000000000000002' as Ulid;
    const foreign = sealBatch(
      [{ type: 'LOT_CLOSING', payload: { lotId: LOT, reason: 'deadline' } }],
      { auctionId: other, seq: 3, hash: (l[2] as LedgerEntry).hash },
      2000,
      C1,
    );
    expect(verifyChain([...l, ...foreign])).toMatchObject({
      ok: false,
      firstBadIndex: 3,
      reason: 'bad_auction',
    });
    const second = sealBatch(
      [{ type: 'AUCTION_CREATED', payload: { title: 'Again', config: {} } }],
      { auctionId: A, seq: 3, hash: (l[2] as LedgerEntry).hash },
      2000,
      C1,
    );
    expect(verifyChain([...l, ...second])).toMatchObject({ ok: false, reason: 'bad_genesis' });
  });

  it('ENG-RT-11: malformed entries are reported, not thrown', () => {
    for (const bad of [null, 'x', 7, [], undefined]) {
      expect(verifyChain([bad as unknown as LedgerEntry])).toMatchObject({
        ok: false,
        firstBadIndex: 0,
      });
    }
    expect(verifyChain([{} as unknown as LedgerEntry])).toMatchObject({ ok: false });
  });

  it('R-ENG-075: headOf', () => {
    expect(headOf([])).toBeNull();
    const l = build(3);
    expect(headOf(l)).toEqual({ seq: 3, hash: (l[2] as LedgerEntry).hash });
  });

  it('T-ENG-060 (R-ENG-077): entries are deeply frozen', () => {
    const l = build(2);
    for (const e of l) {
      expect(Object.isFrozen(e)).toBe(true);
      expect(Object.isFrozen(e.payload)).toBe(true);
      expect(() => {
        (e as { seq: number }).seq = 9;
      }).toThrow(TypeError);
    }
  });
});

describe('InMemoryLedgerStore', () => {
  it('T-ENG-059 (R-ENG-076, R-ENG-104): batch is atomic and head is checked', async () => {
    const store = new InMemoryLedgerStore();
    const events: LedgerEvent[] = [
      { type: 'LOT_CLOSING', payload: { lotId: LOT, reason: 'deadline' } },
      { type: 'LOT_UNSOLD', payload: { lotId: LOT, reason: 'no_bids' } },
      { type: 'LOT_CLOSING', payload: { lotId: LOT, reason: 'early' } },
    ];
    const batch = sealBatch(events, genesisHead(A), 1000, C1);
    await store.append(A, batch, 0);
    expect(await store.head(A)).toEqual({ seq: 3, hash: (batch[2] as LedgerEntry).hash });
    expect((await store.read(A, 2)).map((e) => e.seq)).toEqual([2, 3]);
    await expect(store.append(A, batch, 0)).rejects.toBeInstanceOf(LedgerConflict);
    const bad = [batch[0] as LedgerEntry, batch[2] as LedgerEntry];
    await expect(store.append(A, bad, 3)).rejects.toThrow(RangeError);
    expect((await store.read(A, 1)).length).toBe(3);
    expect(await store.head('01JC0000000000000000000002' as Ulid)).toBeNull();
    // ENG-RT-09: entries of another auction, or not extending the head, are refused.
    const next = sealBatch(
      [{ type: 'LOT_CLOSING', payload: { lotId: LOT, reason: 'deadline' } }],
      { auctionId: A, seq: 3, hash: (batch[2] as LedgerEntry).hash },
      2000,
      C1,
    );
    await expect(store.append('01JC0000000000000000000002' as Ulid, next, 3)).rejects.toThrow(
      RangeError,
    );
    const stale = sealBatch(
      [{ type: 'LOT_CLOSING', payload: { lotId: LOT, reason: 'deadline' } }],
      { auctionId: A, seq: 3, hash: 'f'.repeat(64) },
      2000,
      C1,
    );
    await expect(store.append(A, stale, 3)).rejects.toThrow(RangeError);
    await store.append(A, next, 3);
  });
});
