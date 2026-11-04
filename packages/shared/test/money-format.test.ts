import { describe, expect, it } from 'vitest';
import { formatUsd, parseUsd } from '../src/money-format';
import { Cents, MAX_CENTS } from '../src/money';

describe('formatUsd', () => {
  it('formats with grouping and two decimals', () => {
    expect(formatUsd(Cents(0))).toBe('$0.00');
    expect(formatUsd(Cents(5))).toBe('$0.05');
    expect(formatUsd(Cents(35050))).toBe('$350.50');
    expect(formatUsd(Cents(125000))).toBe('$1,250.00');
    expect(formatUsd(Cents(MAX_CENTS))).toBe('$999,999,999.99');
  });
});

describe('parseUsd (T-RT-005)', () => {
  it('accepts the documented forms', () => {
    expect(parseUsd('350')).toBe(35000);
    expect(parseUsd('350.5')).toBe(35050);
    expect(parseUsd('$350.50')).toBe(35050);
    expect(parseUsd('1,250')).toBe(125000);
    expect(parseUsd('$1,250')).toBe(125000);
    expect(parseUsd(' 0.07 ')).toBe(7);
  });

  it('rejects three decimals and malformed input', () => {
    for (const bad of ['1.234', '', '$', '-5', '1,25', '12,34,567', 'abc', '1.', '.5', '1e3']) {
      expect(() => parseUsd(bad), bad).toThrow();
    }
  });

  it('rejects out-of-range amounts with bad_amount', () => {
    expect(() => parseUsd('1000000000')).toThrow(/range|cents/);
    expect(() => parseUsd('9999999999999999999999')).toThrow();
  });

  it('round-trips sampled values across the full range', () => {
    let s = 12345;
    const samples: number[] = [0, 1, 99, 100, 101, 99_999, 100_000, MAX_CENTS - 1, MAX_CENTS];
    for (let i = 0; i < 5000; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      const hi = s % 1000;
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      samples.push(Math.min(MAX_CENTS, (hi * 100_000_000 + (s % 100_000_000)) % (MAX_CENTS + 1)));
    }
    for (const n of samples) {
      expect(parseUsd(formatUsd(Cents(n)))).toBe(n);
    }
  });
});
