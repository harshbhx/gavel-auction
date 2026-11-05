import { describe, expect, it } from 'vitest';
import {
  ApproveHoldRequest,
  CreateHoldRequest,
  HOLD_ERROR_CODES,
  HoldErrorResponse,
  holdOwnedBySession,
  toBps,
} from '../src';

describe('toBps', () => {
  it('converts the shared 0..1 scale to engine basis points', () => {
    expect(toBps(0.92)).toBe(9200);
    expect(toBps(0.85)).toBe(8500);
    expect(toBps(0.5)).toBe(5000);
  });
  it('clamps and handles NaN', () => {
    expect(toBps(-1)).toBe(0);
    expect(toBps(2)).toBe(10000);
    expect(toBps(Number.NaN)).toBe(0);
  });
  it('maps every hundredth of confidence to an integer without drift', () => {
    // 0.07 * 10000 is 700.0000000000001 in floating point; the engine rejects non-integers.
    for (let i = 0; i <= 100; i += 1) {
      const bps = toBps(i / 100);
      expect(Number.isInteger(bps)).toBe(true);
      expect(bps).toBe(i * 100);
    }
  });
  it('always returns an integer', () => {
    expect(Number.isInteger(toBps(0.123456))).toBe(true);
  });
});

describe('hold contract in shared', () => {
  it('rejects a bidderId on the create request', () => {
    expect(CreateHoldRequest.safeParse({ auctionId: 'a', ceilingCents: 100 }).success).toBe(true);
    expect(
      CreateHoldRequest.safeParse({ auctionId: 'a', ceilingCents: 100, bidderId: 'b' }).success,
    ).toBe(false);
  });
  it('validates approve and error bodies', () => {
    expect(ApproveHoldRequest.safeParse({ orderId: 'o' }).success).toBe(true);
    for (const error of HOLD_ERROR_CODES) {
      expect(HoldErrorResponse.safeParse({ error }).success).toBe(true);
    }
  });
  it('only lets the owning session act on a hold', () => {
    expect(holdOwnedBySession('b1', 'b1')).toBe(true);
    expect(holdOwnedBySession('b1', 'b2')).toBe(false);
    expect(holdOwnedBySession('b1', undefined)).toBe(false);
  });
});
