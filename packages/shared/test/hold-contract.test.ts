import { describe, expect, it } from 'vitest';
import { CreateHoldResponse } from '../src/index';

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
    expect(CreateHoldResponse.safeParse({ holdId: 'h-1', orderId: 'o-1', approveUrl: '' }).success).toBe(
      false,
    );
  });
});
