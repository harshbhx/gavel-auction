import { describe, expect, it } from 'vitest';
import {
  AbandonHoldResponse,
  ApproveHoldRequest,
  BIDDER_NAME_FORBIDDEN_PATTERN,
  MAX_NAME_CHARS,
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

describe('ApproveHoldRequest name (issue 1074)', () => {
  it('stays valid without a name and bounds the name like the wire does', () => {
    expect(ApproveHoldRequest.safeParse({ orderId: 'o-1' }).success).toBe(true);
    expect(ApproveHoldRequest.safeParse({ orderId: 'o-1', name: 'Ada' }).success).toBe(true);
    expect(ApproveHoldRequest.safeParse({ orderId: 'o-1', name: ' ' }).success).toBe(false);
    const edge = 'a'.repeat(MAX_NAME_CHARS);
    expect(ApproveHoldRequest.safeParse({ orderId: 'o-1', name: edge }).success).toBe(true);
    expect(ApproveHoldRequest.safeParse({ orderId: 'o-1', name: `${edge}a` }).success).toBe(false);
  });
});

describe('bidder name invisible characters (issue 1881)', () => {
  it('forbids zero-width and direction marks and names that are blank without them', () => {
    const marks = [
      '\u200B',
      '\u200D',
      '\u200E',
      '\u200F',
      '\u2028',
      '\u2029',
      '\u202F',
      '\u2060',
      '\u2064',
      '\u206F',
      '\uFEFF',
      '\u061C',
    ];
    for (const mark of marks) {
      expect(BIDDER_NAME_FORBIDDEN_PATTERN.test(mark), mark.codePointAt(0)?.toString(16)).toBe(
        true,
      );
      expect(ApproveHoldRequest.safeParse({ orderId: 'o-1', name: mark }).success).toBe(false);
      expect(ApproveHoldRequest.safeParse({ orderId: 'o-1', name: `Alice${mark}` }).success).toBe(
        false,
      );
    }
    expect(ApproveHoldRequest.safeParse({ orderId: 'o-1', name: 'Alice' }).success).toBe(true);
    expect(BIDDER_NAME_FORBIDDEN_PATTERN.test('Zoë 山田')).toBe(false);
  });
});
