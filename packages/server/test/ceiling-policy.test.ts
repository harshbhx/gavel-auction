import { describe, expect, it } from 'vitest';
import {
  CEILING_PRESETS_CENTS as ENGINE_PRESETS,
  DEFAULT_MAX_CEILING_CENTS as ENGINE_MAX,
  MIN_CEILING_CENTS as ENGINE_MIN,
  checkCeiling,
} from '@gavel/engine';
import {
  DEFAULT_MAX_CEILING_CENTS as PAY_MAX,
  MIN_CEILING_CENTS as PAY_MIN,
  validateCeiling,
} from '@gavel/payments';
import { CEILING_PRESETS_CENTS, DEFAULT_MAX_CEILING_CENTS, MIN_CEILING_CENTS } from '@gavel/shared';

describe('ceiling policy across engine, payments and shared', () => {
  it('T-RT-04 R-ENG-014 R-PAY-031 every package uses the shared presets, minimum and cap', () => {
    expect([...ENGINE_PRESETS]).toEqual([...CEILING_PRESETS_CENTS]);
    expect(ENGINE_MIN).toBe(MIN_CEILING_CENTS);
    expect(PAY_MIN).toBe(MIN_CEILING_CENTS);
    expect(ENGINE_MAX).toBe(DEFAULT_MAX_CEILING_CENTS);
    expect(PAY_MAX).toBe(DEFAULT_MAX_CEILING_CENTS);
  });

  it('T-RT-04 R-ENG-040 R-PAY-005 every preset passes payments and the engine on a default deploy', () => {
    const rules = { maxCeilingCents: PAY_MAX, presetsCents: [...CEILING_PRESETS_CENTS] };
    for (const c of CEILING_PRESETS_CENTS) {
      expect(validateCeiling(c, rules)).toBe(c);
      expect(checkCeiling(c, ENGINE_MAX)).toBe('ok');
    }
  });

  it('T-RT-04 R-ENG-040 R-PAY-005 a ceiling the engine would refuse never reaches PayPal', () => {
    const rules = { maxCeilingCents: PAY_MAX, presetsCents: [...CEILING_PRESETS_CENTS] };
    for (const c of [1, 50, MIN_CEILING_CENTS - 1, PAY_MAX + 1]) {
      expect(() => validateCeiling(c, rules)).toThrow();
      expect(checkCeiling(c, ENGINE_MAX)).toBe('bad_ceiling');
    }
  });
});
