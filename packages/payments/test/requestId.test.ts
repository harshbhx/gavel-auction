import { describe, expect, it } from 'vitest';
import { base32, buildRequestId, type RequestIdParts } from '../src/requestId.js';

const p: RequestIdParts = {
  auctionId: 'a1',
  op: 'capture',
  holdId: 'h1',
  amountCents: 22000,
  generation: 0,
};

describe('requestId', () => {
  it('T-PAY-008 deterministic, sensitive to generation and amount, 44 chars base32', () => {
    expect(buildRequestId(p)).toBe(buildRequestId({ ...p }));
    expect(buildRequestId({ ...p, generation: 1 })).not.toBe(buildRequestId(p));
    expect(buildRequestId({ ...p, amountCents: 21000 })).not.toBe(buildRequestId(p));
    for (const id of [buildRequestId(p), buildRequestId({ ...p, op: 'void' })]) {
      expect(id).toHaveLength(44);
      expect(id).toMatch(/^gv1-[A-Z2-7]{40}$/);
    }
  });

  it('base32 matches RFC 4648 vectors', () => {
    const enc = (s: string) => base32(new TextEncoder().encode(s));
    expect(enc('f')).toBe('MY');
    expect(enc('fo')).toBe('MZXQ');
    expect(enc('foobar')).toBe('MZXW6YTBOI');
  });

  it('rejects bad amounts and generations', () => {
    expect(() => buildRequestId({ ...p, amountCents: 1.5 })).toThrow(RangeError);
    expect(() => buildRequestId({ ...p, generation: -1 })).toThrow(RangeError);
  });
});
