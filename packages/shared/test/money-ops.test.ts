import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { GavelError } from '../src/errors';
import { Cents, MAX_CENTS } from '../src/money';
import { addCents, cmpCents, maxCents, minCents, subCents } from '../src/money-ops';

const centsArb = fc.integer({ min: 0, max: MAX_CENTS }).map((n) => Cents(n));

describe('money-ops (T-RT-006)', () => {
  it('add agrees with BigInt reference', () => {
    fc.assert(
      fc.property(centsArb, centsArb, (a, b) => {
        const expected = BigInt(a) + BigInt(b);
        if (expected > BigInt(MAX_CENTS)) {
          expect(() => addCents(a, b)).toThrow(GavelError);
        } else {
          expect(addCents(a, b)).toBe(Number(expected));
        }
      }),
      { numRuns: 1000 },
    );
  });

  it('sub agrees with BigInt reference', () => {
    fc.assert(
      fc.property(centsArb, centsArb, (a, b) => {
        const expected = BigInt(a) - BigInt(b);
        if (expected < 0n) {
          expect(() => subCents(a, b)).toThrow(GavelError);
        } else {
          expect(subCents(a, b)).toBe(Number(expected));
        }
      }),
      { numRuns: 1000 },
    );
  });

  it('min agrees with BigInt reference', () => {
    fc.assert(
      fc.property(centsArb, centsArb, (a, b) => {
        const expected = a <= b ? a : b;
        expect(minCents(a, b)).toBe(expected);
      }),
      { numRuns: 500 },
    );
  });

  it('max agrees with BigInt reference', () => {
    fc.assert(
      fc.property(centsArb, centsArb, (a, b) => {
        const expected = a >= b ? a : b;
        expect(maxCents(a, b)).toBe(expected);
      }),
      { numRuns: 500 },
    );
  });

  it('cmp returns correct ordering', () => {
    fc.assert(
      fc.property(centsArb, centsArb, (a, b) => {
        const result = cmpCents(a, b);
        if (a < b) expect(result).toBe(-1);
        else if (a > b) expect(result).toBe(1);
        else expect(result).toBe(0);
      }),
      { numRuns: 500 },
    );
  });

  it('overflow throws bad_amount', () => {
    const max = Cents(MAX_CENTS);
    const one = Cents(1);
    try {
      addCents(max, one);
      throw new Error('did not throw');
    } catch (e) {
      expect(e).toBeInstanceOf(GavelError);
      expect((e as GavelError).code).toBe('bad_amount');
    }
  });

  it('negative sub throws bad_amount', () => {
    const zero = Cents(0);
    const one = Cents(1);
    try {
      subCents(zero, one);
      throw new Error('did not throw');
    } catch (e) {
      expect(e).toBeInstanceOf(GavelError);
      expect((e as GavelError).code).toBe('bad_amount');
    }
  });
});
