import { describe, expect, it } from 'vitest';
import {
  CEILING_PRESETS_CENTS,
  DEFAULT_MAX_CEILING_CENTS,
  MIN_CEILING_CENTS,
  checkCeiling,
} from '../src/policy.js';

describe('policy', () => {
  it('T-ENG-013 R-ENG-014: presets and bounds', () => {
    expect([...CEILING_PRESETS_CENTS]).toEqual([10000, 25000, 50000, 100000]);
    expect(MIN_CEILING_CENTS).toBe(100);
    expect(DEFAULT_MAX_CEILING_CENTS).toBe(5_000_000_000);
  });

  it('T-ENG-013 R-ENG-040: out-of-range ceilings fail bad_ceiling', () => {
    expect(checkCeiling(99, 100000)).toBe('bad_ceiling');
    expect(checkCeiling(100001, 100000)).toBe('bad_ceiling');
    expect(checkCeiling(100, 100000)).toBe('ok');
    expect(checkCeiling(100000, 100000)).toBe('ok');
    expect(checkCeiling(150.5, 100000)).toBe('bad_ceiling');
    expect(checkCeiling(Number.NaN, 100000)).toBe('bad_ceiling');
  });

  it('T-ENG-013 R-ENG-040 UIX-59: the default cap lets a bidder type a limit above $1000, and refuses past it', () => {
    expect(checkCeiling(100_001, DEFAULT_MAX_CEILING_CENTS)).toBe('ok');
    expect(checkCeiling(250_000, DEFAULT_MAX_CEILING_CENTS)).toBe('ok');
    expect(checkCeiling(DEFAULT_MAX_CEILING_CENTS, DEFAULT_MAX_CEILING_CENTS)).toBe('ok');
    expect(checkCeiling(DEFAULT_MAX_CEILING_CENTS + 1, DEFAULT_MAX_CEILING_CENTS)).toBe(
      'bad_ceiling',
    );
  });
});
