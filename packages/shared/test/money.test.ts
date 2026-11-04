import { describe, expect, it } from 'vitest';
import { Cents } from '../src/money';
import { GavelError } from '../src/errors';

describe('Cents (T-RT-004)', () => {
  it('accepts valid amounts', () => {
    expect(Cents(35000)).toBe(35000);
    expect(Cents(0)).toBe(0);
    expect(Cents(99_999_999_999)).toBe(99_999_999_999);
  });
  it.each([1.5, -1, NaN, 1e12, Infinity])('rejects %s with bad_amount', (v) => {
    try {
      Cents(v);
      throw new Error('did not throw');
    } catch (e) {
      expect(e).toBeInstanceOf(GavelError);
      expect((e as GavelError).code).toBe('bad_amount');
    }
  });
});
