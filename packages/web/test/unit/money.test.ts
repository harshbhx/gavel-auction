import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formatUsd, formatUsdCompact, parseUsdToCents } from '../../src/util/money';

describe('parseUsdToCents', () => {
  it.each([
    ['350', 35000],
    ['350.5', 35050],
    ['350.55', 35055],
    ['$1,234.50', 123450],
  ])('parses %s', (input, cents) => {
    expect(parseUsdToCents(input)).toBe(cents);
  });

  it.each(['350.555', '', '-1', '1e3', '0', '0.00', 'abc', '1,23', '1.'])('rejects %j', (input) => {
    expect(parseUsdToCents(input)).toBeNull();
  });

  it('round trips with formatUsd for integer cents', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000_000 }), (cents) => {
        expect(parseUsdToCents(formatUsd(cents))).toBe(cents);
      }),
    );
  });
});

describe('formatUsd', () => {
  it('formats cents with grouping and two decimals', () => {
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(5)).toBe('$0.05');
    expect(formatUsd(35000)).toBe('$350.00');
    expect(formatUsd(123456789)).toBe('$1,234,567.89');
  });

  it('rejects non-integer or negative cents', () => {
    expect(() => formatUsd(1.5)).toThrow(RangeError);
    expect(() => formatUsd(-1)).toThrow(RangeError);
  });

  it('compact variant drops .00 only', () => {
    expect(formatUsdCompact(35000)).toBe('$350');
    expect(formatUsdCompact(35050)).toBe('$350.50');
    expect(formatUsdCompact(0)).toBe('$0');
  });
});
