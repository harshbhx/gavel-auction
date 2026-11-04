import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { Cents, MAX_CENTS, add, cmp, max, min, sub } from '../src/money';
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

describe('checked arithmetic (T-RT-006)', () => {
  it('adds, subtracts, compares, min and max', () => {
    expect(add(Cents(100), Cents(50))).toBe(150);
    expect(sub(Cents(100), Cents(50))).toBe(50);
    expect(cmp(Cents(1), Cents(2))).toBe(-1);
    expect(cmp(Cents(2), Cents(2))).toBe(0);
    expect(cmp(Cents(3), Cents(2))).toBe(1);
    expect(min(Cents(1), Cents(2))).toBe(1);
    expect(max(Cents(1), Cents(2))).toBe(2);
  });

  it('throws bad_amount when an add overflows the range', () => {
    expect(() => add(Cents(MAX_CENTS), Cents(1))).toThrow(GavelError);
    expect(() => add(Cents(99_999_999_999), Cents(100))).toThrow(GavelError);
  });

  it('throws bad_amount when a subtraction goes below zero', () => {
    try {
      sub(Cents(1), Cents(2));
      throw new Error('did not throw');
    } catch (e) {
      expect((e as GavelError).code).toBe('bad_amount');
    }
  });

  it('matches a BigInt reference for in-range operands', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: MAX_CENTS }),
        fc.integer({ min: 0, max: MAX_CENTS }),
        (a, b) => {
          const sum = BigInt(a) + BigInt(b);
          if (sum <= BigInt(MAX_CENTS)) expect(BigInt(add(Cents(a), Cents(b)))).toBe(sum);
          else expect(() => add(Cents(a), Cents(b))).toThrow(GavelError);
          const diff = BigInt(a) - BigInt(b);
          if (diff >= 0n) expect(BigInt(sub(Cents(a), Cents(b)))).toBe(diff);
          else expect(() => sub(Cents(a), Cents(b))).toThrow(GavelError);
        },
      ),
    );
  });
});
