import { describe, expect, it } from 'vitest';
import {
  AbandonHoldResponse,
  CreateHoldResponse,
  HOLD_STATUSES,
  HoldViewResponse,
} from '../src/index';

describe('CreateHoldResponse', () => {
  it('accepts a response without an approve link', () => {
    expect(CreateHoldResponse.safeParse({ holdId: 'h-1', orderId: 'o-1' }).success).toBe(true);
  });

  it('accepts an optional approve link for the redirect fallback', () => {
    const parsed = CreateHoldResponse.safeParse({
      holdId: 'h-1',
      orderId: 'o-1',
      approveUrl: 'https://www.sandbox.paypal.com/approve?token=o-1',
    });
    expect(parsed.success).toBe(true);
  });

  it('still rejects unknown fields and an empty approve link', () => {
    expect(CreateHoldResponse.safeParse({ holdId: 'h-1', orderId: 'o-1', extra: 1 }).success).toBe(
      false,
    );
    expect(
      CreateHoldResponse.safeParse({ holdId: 'h-1', orderId: 'o-1', approveUrl: '' }).success,
    ).toBe(false);
  });
});

describe('hold read and abandon responses (HRD-69, issue 896)', () => {
  it('reads a hold with one of the hold statuses', () => {
    for (const status of HOLD_STATUSES) {
      expect(HoldViewResponse.safeParse({ holdId: 'h-1', status, ceilingCents: 100 }).success).toBe(
        true,
      );
    }
    expect(
      HoldViewResponse.safeParse({ holdId: 'h-1', status: 'SPENT', ceilingCents: 100 }).success,
    ).toBe(false);
    expect(
      HoldViewResponse.safeParse({
        holdId: 'h-1',
        status: 'HELD',
        ceilingCents: 100,
        bidderId: 'b',
      }).success,
    ).toBe(false);
  });

  it('answers an abandon with the released hold only', () => {
    expect(AbandonHoldResponse.safeParse({ holdId: 'h-1', released: true }).success).toBe(true);
    expect(AbandonHoldResponse.safeParse({ holdId: 'h-1', released: false }).success).toBe(false);
  });
});
