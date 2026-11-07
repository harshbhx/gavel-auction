import type { Cents } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { settlementInvariants, type OwnHoldDetail } from '../../src/runtime/own-holds';

const hold = (over: Partial<OwnHoldDetail>): OwnHoldDetail => ({
  idSuffix: 'HOLD-1',
  status: 'HELD',
  ceilingCents: 50000 as Cents,
  capturedCents: 0,
  releasedCents: 0,
  remainder: 'none',
  ...over,
});

describe('settlement invariants for the ladder (issue 712)', () => {
  it('is ok for one capture within its ceiling and released losers', () => {
    expect(
      settlementInvariants({
        a: hold({ status: 'CAPTURED', capturedCents: 13000, releasedCents: 37000 }),
        b: hold({ status: 'VOIDED', ceilingCents: 30000 as Cents, releasedCents: 30000 }),
      }),
    ).toEqual({ ok: true, violations: [] });
  });

  it('names a second capture', () => {
    const out = settlementInvariants({
      a: hold({ status: 'CAPTURED', capturedCents: 13000 }),
      b: hold({ status: 'CAPTURED', capturedCents: 12000 }),
    });
    expect(out.ok).toBe(false);
    expect(out.violations).toContain('more_than_one_capture');
  });

  it('names a capture or a release beyond the ceiling', () => {
    const out = settlementInvariants({
      a: hold({ status: 'CAPTURED', capturedCents: 60000 }),
      b: hold({ status: 'VOIDED', releasedCents: 40000, capturedCents: 20000 }),
    });
    expect(out.violations).toEqual(
      expect.arrayContaining([
        'capture_over_ceiling',
        'more_than_ceiling_accounted',
        'capture_without_captured_status',
      ]),
    );
  });

  it('carries no amount, id or name', () => {
    const out = settlementInvariants({
      a: hold({ status: 'CAPTURED', capturedCents: 60000 }),
    });
    expect(JSON.stringify(out)).not.toMatch(/60000|50000|HOLD/);
  });
});
