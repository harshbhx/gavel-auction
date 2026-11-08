import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashPublicEntry, verifyPublicChain } from '../src/public-chain';
import type { ReplayEvent } from '../src/replay-bundle';

const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

function chain(payloads: Array<Record<string, unknown>>, types?: string[]): ReplayEvent[] {
  const out: ReplayEvent[] = [];
  let prev = '0'.repeat(64);
  payloads.forEach((payload, i) => {
    const body = {
      v: 4 as const,
      auctionId: 'A1',
      seq: i + 1,
      at: 1000 + i,
      type: types?.[i] ?? 'BID_ACCEPTED',
      cmd: null,
      payload,
      redacted: [] as string[],
      fullHash: null,
      prev,
    };
    const hash = hashPublicEntry(body);
    out.push({ ...body, hash } as ReplayEvent);
    prev = hash;
  });
  return out;
}

describe('hashPublicEntry', () => {
  it('is the SHA-256 of canonical JSON: sorted keys, no spaces, ascii escapes', () => {
    expect(hashPublicEntry({ b: [1, true, null], a: 'x' })).toBe(
      sha('{"a":"x","b":[1,true,null]}'),
    );
    expect(hashPublicEntry({ k: 'café' })).toBe(sha('{"k":"caf\\u00e9"}'));
  });

  it('hashes inputs longer than one block, and across the padding edge', () => {
    for (const n of [0, 54, 55, 56, 63, 64, 120, 1000]) {
      const v = 'a'.repeat(n);
      expect(hashPublicEntry({ v })).toBe(sha(`{"v":"${v}"}`));
    }
  });

  it('orders keys by code point and handles nested values', () => {
    const body = { '\u{1F600}': 1, '～': 2, z: { y: [[], {}] } };
    expect(hashPublicEntry(body)).toBe(sha('{"z":{"y":[[],{}]},"\\uff5e":2,"\\ud83d\\ude00":1}'));
  });

  it('rejects what the engine rejects', () => {
    expect(() => hashPublicEntry({ n: 1.5 })).toThrow();
    expect(() => hashPublicEntry({ n: -0 })).toThrow();
    expect(() => hashPublicEntry({ s: '\ud800' })).toThrow();
    expect(() => hashPublicEntry({ s: '\udc00x' })).toThrow();
    expect(() => hashPublicEntry({ ['\ud800']: 1 })).toThrow();
    expect(() => hashPublicEntry({ f: () => 1 })).toThrow();
    expect(() => hashPublicEntry({ d: new Date(0) })).toThrow();
    expect(() => hashPublicEntry(JSON.parse('{"__proto__":1}'))).toThrow();
    // eslint-disable-next-line no-sparse-arrays
    expect(() => hashPublicEntry({ a: [1, , 3] })).toThrow();
  });
});

describe('verifyPublicChain', () => {
  it('accepts a good chain and reports its head', () => {
    const c = chain([{ a: 1 }, { a: 2 }]);
    expect(verifyPublicChain(c)).toEqual({
      ok: true,
      count: 2,
      headHash: c[1]?.hash,
      closed: false,
    });
    expect(verifyPublicChain([])).toMatchObject({ ok: true, count: 0 });
  });

  it('reports closed only when AUCTION_CLOSED names the entry before it', () => {
    const open = chain([{ a: 1 }]);
    const first = open[0] as ReplayEvent;
    const anchored = chain(
      [{ a: 1 }, { headHash: first.hash }],
      ['BID_ACCEPTED', 'AUCTION_CLOSED'],
    );
    // fullHash is null in this fixture, so the unredacted anchor is null and does not match.
    expect(verifyPublicChain(anchored)).toMatchObject({ ok: true, closed: false });
    const redacted = (() => {
      const first = chain([{ a: 1 }])[0] as ReplayEvent;
      const body = {
        v: 4 as const,
        auctionId: 'A1',
        seq: 2,
        at: 1,
        type: 'AUCTION_CLOSED',
        cmd: null,
        payload: { headHash: 'private' },
        redacted: ['headHash'],
        fullHash: null,
        prev: first.hash,
      };
      return [first, { ...body, hash: hashPublicEntry(body) } as ReplayEvent];
    })();
    expect(verifyPublicChain(redacted)).toMatchObject({ ok: true, closed: false });
    const named = (() => {
      const first = chain([{ a: 1 }])[0] as ReplayEvent;
      const body = {
        v: 4 as const,
        auctionId: 'A1',
        seq: 2,
        at: 1,
        type: 'AUCTION_CLOSED',
        cmd: null,
        payload: { headHash: first.hash },
        redacted: ['headHash'],
        fullHash: null,
        prev: first.hash,
      };
      return [first, { ...body, hash: hashPublicEntry(body) } as ReplayEvent];
    })();
    expect(verifyPublicChain(named)).toMatchObject({ ok: true, closed: true });
  });

  it('names the failing entry and the reason', () => {
    const c = chain([{ a: 1 }, { a: 2 }, { a: 3 }]);
    const edited = structuredClone(c);
    (edited[1] as ReplayEvent).payload = { a: 9 };
    expect(verifyPublicChain(edited)).toEqual({ ok: false, firstBadIndex: 1, reason: 'bad_hash' });
    expect(verifyPublicChain([c[0], c[2]] as ReplayEvent[])).toMatchObject({
      firstBadIndex: 1,
      reason: 'bad_seq',
    });
    const relinked = structuredClone(c);
    (relinked[2] as ReplayEvent).prev = '1'.repeat(64);
    expect(verifyPublicChain(relinked)).toMatchObject({ firstBadIndex: 2, reason: 'bad_prev' });
    const old = structuredClone(c);
    (old[0] as unknown as { v: number }).v = 3;
    expect(verifyPublicChain(old)).toMatchObject({ firstBadIndex: 0, reason: 'bad_version' });
    expect(verifyPublicChain([null as unknown as ReplayEvent])).toMatchObject({
      reason: 'bad_version',
    });
    const bad = structuredClone(c);
    (bad[0] as ReplayEvent).payload = { n: 1.5 };
    expect(verifyPublicChain(bad)).toMatchObject({ firstBadIndex: 0, reason: 'bad_hash' });
  });

  it('detects a cut tail against the claimed head', () => {
    const c = chain([{ a: 1 }, { a: 2 }]);
    const head = { seq: 2, hash: c[1]?.hash as string };
    expect(verifyPublicChain(c, head)).toMatchObject({ ok: true });
    expect(verifyPublicChain(c.slice(0, 1), head)).toEqual({
      ok: false,
      firstBadIndex: 1,
      reason: 'truncated',
    });
    expect(verifyPublicChain([], head)).toMatchObject({ reason: 'truncated' });
  });
});
