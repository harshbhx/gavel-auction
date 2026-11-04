import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SeqIds } from '../src/ids-mint';
import { decodeMsg, encodeMsg } from '../src/wire/codec';

const MID = '01J9ZQ6A0B2C4D6F8H0J2K4M6N';
const bid = { v: 1, t: 'bid', mid: MID, amount: 12000, source: 'qr' };

describe('wire codec (T-RT-017)', () => {
  it('round-trips a valid client message', () => {
    const enc = encodeMsg(bid);
    expect(enc.ok).toBe(true);
    if (!enc.ok) return;
    const dec = decodeMsg(enc.value, 'client');
    expect(dec).toEqual({ ok: true, value: bid });
  });

  it('decodes server frames when told the sender is the server', () => {
    const frame = JSON.stringify({ v: 1, t: 'error', code: 'rate_limited', message: 'x' });
    expect(decodeMsg(frame, 'server').ok).toBe(true);
  });

  it('refuses server-only frames from a client and client frames from a server', () => {
    const price = JSON.stringify({
      v: 1,
      t: 'hammer',
      seq: 1,
      ts: 1,
      winnerId: null,
      price: 1,
      ranking: [],
    });
    expect(decodeMsg(price, 'client').ok).toBe(false);
    expect(decodeMsg(JSON.stringify(bid), 'server').ok).toBe(false);
    expect(decodeMsg(JSON.stringify(bid), 'client').ok).toBe(true);
  });

  it('returns errors, not throws, for invalid input', () => {
    expect(encodeMsg(null).ok).toBe(false);
    expect(encodeMsg({ v: 1, t: 'bid' }).ok).toBe(false);
    expect(encodeMsg({ v: 1, t: 'toString' }).ok).toBe(false);
    const circular: Record<string, unknown> = { v: 1, t: 'bid' };
    circular.self = circular;
    expect(encodeMsg(circular).ok).toBe(false);
    expect(decodeMsg(undefined, 'client').ok).toBe(false);
    expect(decodeMsg('{', 'client').ok).toBe(false);
  });

  it('never throws on arbitrary strings', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 2000 }), (s) => {
        expect(() => decodeMsg(s, 'client')).not.toThrow();
        expect(decodeMsg(s, 'client').ok).toBe(false);
      }),
    );
  });

  it('never throws on arbitrary bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 2000 }), (b) => {
        expect(() => decodeMsg(b, 'server')).not.toThrow();
      }),
    );
  });

  it('never throws on arbitrary JSON values, encode or decode', () => {
    fc.assert(
      fc.property(fc.anything(), (v) => {
        expect(() => encodeMsg(v)).not.toThrow();
        expect(() => decodeMsg(JSON.stringify(v) ?? '', 'client')).not.toThrow();
      }),
    );
  });

  it('survives depth 10000 JSON and huge numbers', () => {
    const deep = '['.repeat(10_000) + ']'.repeat(10_000);
    expect(decodeMsg(deep, 'client').ok).toBe(false);
    const deepObj = '{"a":'.repeat(10_000) + '1' + '}'.repeat(10_000);
    expect(decodeMsg(deepObj, 'client').ok).toBe(false);
    const big = `{"v":1,"t":"bid","mid":"${MID}","amount":1e999,"source":"qr"}`;
    expect(decodeMsg(big, 'client').ok).toBe(false);
    expect(decodeMsg(`{"v":1,"t":"bid","amount":${'9'.repeat(5000)}}`, 'client').ok).toBe(false);
  });
});

describe('frame caps are directional (R-RT-014, R-RT-121)', () => {
  const ids = new SeqIds();
  const auctionId = ids.mint();
  const roster = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      bidderId: ids.mint(),
      paddle: i + 1,
      name: `Bidder number ${i + 1}`,
      hold: 'HELD' as const,
    }));
  const state = (n: number) => ({
    v: 1,
    t: 'state',
    seq: 5,
    ts: 1_789_000_000_000,
    snapshot: {
      auctionId,
      config: {
        currency: 'USD',
        reserve: 10000,
        minIncrement: 1000,
        endTs: 1_789_000_060_000,
        softCloseWindowMs: 10000,
        softCloseExtensionMs: 10000,
        maxExtensions: 3,
        ceilingPresets: [50000],
        confirmConfidenceThreshold: 0.7,
      },
      status: 'OPEN',
      price: null,
      leaderId: null,
      endTs: 1_789_000_060_000,
      minNext: 10000,
      roster: roster(n),
      recentAudit: [],
    },
  });

  it('encodes and decodes a state frame for 150 bidders above 16 KiB', () => {
    const enc = encodeMsg(state(150));
    expect(enc.ok).toBe(true);
    if (!enc.ok) return;
    expect(new TextEncoder().encode(enc.value).length).toBeGreaterThan(16 * 1024);
    expect(decodeMsg(enc.value, 'server').ok).toBe(true);
    expect(decodeMsg(enc.value, 'client').ok).toBe(false);
  });

  it('still rejects an oversized client frame', () => {
    const big = { ...bid, transcript: 'x'.repeat(100) };
    const text = JSON.stringify(big) + ' '.repeat(17_000);
    expect(decodeMsg(text, 'client').ok).toBe(false);
  });

  it('rejects a roster beyond 200 or with duplicate paddles', () => {
    expect(encodeMsg(state(201)).ok).toBe(false);
    const dup = state(3);
    dup.snapshot.roster[1] = {
      ...dup.snapshot.roster[1],
      paddle: 1,
    } as (typeof dup.snapshot.roster)[number];
    expect(encodeMsg(dup).ok).toBe(false);
  });
});
