import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { centsToDecimal, decimalToCents, MoneyError } from '../src/money.js';

describe('money', () => {
  it('T-PAY-001 centsToDecimal fixed cases', () => {
    const cases: Array<[number, string]> = [
      [0, '0.00'],
      [5, '0.05'],
      [100, '1.00'],
      [1050, '10.50'],
      [35000, '350.00'],
      [999999999, '9999999.99'],
    ];
    for (const [c, s] of cases) expect(centsToDecimal(c)).toBe(s);
  });

  it('T-PAY-002 round trip over 1000 integers and invalid inputs throw', () => {
    let seed = 123456789;
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };
    for (let i = 0; i < 1000; i++) {
      const n = next() % 1_000_000_001;
      expect(decimalToCents(centsToDecimal(n))).toBe(n);
    }
    for (const bad of [1.5, -1, NaN, Infinity, 2 ** 60]) {
      expect(() => centsToDecimal(bad)).toThrow(MoneyError);
    }
    for (const bad of ['1.234', '1,5', '', '0.5', '5', '-1.00', '1.0', ' 1.00']) {
      expect(() => decimalToCents(bad)).toThrow(MoneyError);
    }
  });

  it('lenient accepts fewer decimals only when asked', () => {
    expect(decimalToCents('0.5', { lenient: true })).toBe(50);
    expect(decimalToCents('5', { lenient: true })).toBe(500);
    expect(() => decimalToCents('1.234', { lenient: true })).toThrow(MoneyError);
  });

  it('src contains no float helpers', () => {
    const src = readFileSync(new URL('../src/money.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/\bNumber\b|parseFloat|toFixed/);
  });
});
