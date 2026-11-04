import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodeMsg, encodeMsg } from '../src/wire/codec';

const MID = '01J9ZQ6A0B2C4D6F8H0J2K4M6N';
const bid = { v: 1, t: 'bid', mid: MID, amount: 12000, source: 'qr' };

describe('wire codec (T-RT-017)', () => {
  it('round-trips a valid client message', () => {
    const enc = encodeMsg(bid);
    expect(enc.ok).toBe(true);
    if (!enc.ok) return;
    const dec = decodeMsg(enc.value);
    expect(dec).toEqual({ ok: true, value: bid });
  });

  it('decodes server frames too', () => {
    const res = decodeMsg(JSON.stringify({ v: 1, t: 'error', code: 'rate_limited', message: 'x' }));
    expect(res.ok).toBe(true);
  });

  it('returns errors, not throws, for invalid input', () => {
    expect(encodeMsg(null).ok).toBe(false);
    expect(encodeMsg({ v: 1, t: 'bid' }).ok).toBe(false);
    expect(encodeMsg({ v: 1, t: 'toString' }).ok).toBe(false);
    const circular: Record<string, unknown> = { v: 1, t: 'bid' };
    circular.self = circular;
    expect(encodeMsg(circular).ok).toBe(false);
    expect(decodeMsg(undefined).ok).toBe(false);
    expect(decodeMsg('{').ok).toBe(false);
  });

  it('never throws on arbitrary strings', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 2000 }), (s) => {
        expect(() => decodeMsg(s)).not.toThrow();
        expect(decodeMsg(s).ok).toBe(false);
      }),
    );
  });

  it('never throws on arbitrary bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 2000 }), (b) => {
        expect(() => decodeMsg(b)).not.toThrow();
      }),
    );
  });

  it('never throws on arbitrary JSON values, encode or decode', () => {
    fc.assert(
      fc.property(fc.anything(), (v) => {
        expect(() => encodeMsg(v)).not.toThrow();
        expect(() => decodeMsg(JSON.stringify(v) ?? '')).not.toThrow();
      }),
    );
  });

  it('survives depth 10000 JSON and huge numbers', () => {
    const deep = '['.repeat(10_000) + ']'.repeat(10_000);
    expect(decodeMsg(deep).ok).toBe(false);
    const deepObj = '{"a":'.repeat(10_000) + '1' + '}'.repeat(10_000);
    expect(decodeMsg(deepObj).ok).toBe(false);
    const big = `{"v":1,"t":"bid","mid":"${MID}","amount":1e999,"source":"qr"}`;
    expect(decodeMsg(big).ok).toBe(false);
    expect(decodeMsg(`{"v":1,"t":"bid","amount":${'9'.repeat(5000)}}`).ok).toBe(false);
    expect(encodeMsg({ ...bid, amount: Number.MAX_VALUE }).ok).toBe(false);
  });
});
