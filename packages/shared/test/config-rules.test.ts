import { describe, expect, it } from 'vitest';
import { checkAuctionConfig, formatPath } from '../src/config-rules';

const NOW = 1_789_000_000_000;

const base = {
  currency: 'USD',
  reserve: 10000,
  minIncrement: 500,
  endTs: NOW + 600_000,
  softCloseWindowMs: 30_000,
  softCloseExtensionMs: 30_000,
  maxExtensions: 5,
  ceilingPresets: [20000, 50000],
  confirmConfidenceThreshold: 0.8,
};

const errorsFor = (patch: Record<string, unknown>): string[] => {
  const res = checkAuctionConfig({ ...base, ...patch }, NOW);
  return res.ok ? [] : res.errors;
};

describe('auction config boundaries (T-RT-011)', () => {
  it('accepts the base config', () => {
    expect(checkAuctionConfig(base, NOW).ok).toBe(true);
  });

  it('reserve: 99 fails, 100 passes', () => {
    expect(errorsFor({ reserve: 99, ceilingPresets: [20000] })).toEqual([
      'reserve: reserve must be at least 100 cents',
    ]);
    expect(errorsFor({ reserve: 100, ceilingPresets: [20000] })).toEqual([]);
  });

  it('reserve must be whole cents', () => {
    expect(errorsFor({ reserve: 100.5 })).not.toEqual([]);
  });

  it('minIncrement: 0 fails, 1 passes', () => {
    expect(errorsFor({ minIncrement: 0 })).toEqual(['minIncrement: minIncrement must be positive']);
    expect(errorsFor({ minIncrement: 1 })).toEqual([]);
  });

  it('softCloseExtensionMs: 600000 passes, 600001 fails', () => {
    expect(errorsFor({ softCloseExtensionMs: 600_000 })).toEqual([]);
    expect(errorsFor({ softCloseExtensionMs: 600_001 })).toHaveLength(1);
  });

  it('maxExtensions: 50 passes, 51 fails', () => {
    expect(errorsFor({ maxExtensions: 50 })).toEqual([]);
    expect(errorsFor({ maxExtensions: 51 })).toHaveLength(1);
  });

  it('endTs must be in the future', () => {
    expect(errorsFor({ endTs: NOW })).toEqual(['endTs: must be in the future']);
    expect(errorsFor({ endTs: NOW + 1 })).toEqual([]);
  });

  it('presets: unsorted fails with an indexed path', () => {
    expect(errorsFor({ ceilingPresets: [50000, 20000] })).toEqual([
      'ceilingPresets[1]: ceilingPresets must be strictly ascending',
    ]);
  });

  it('presets: 8 entries pass, 9 fail, empty fails', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => 10000 + i * 100);
    expect(errorsFor({ ceilingPresets: many(8) })).toEqual([]);
    expect(errorsFor({ ceilingPresets: many(9) })).toHaveLength(1);
    expect(errorsFor({ ceilingPresets: [] })).toHaveLength(1);
  });

  it('presets: a value below the reserve fails', () => {
    expect(errorsFor({ ceilingPresets: [9999, 50000] })).toEqual([
      'ceilingPresets[0]: ceilingPresets must not be below the reserve',
    ]);
  });

  it('reports every problem, not just the first', () => {
    expect(errorsFor({ minIncrement: 0, maxExtensions: 51 })).toHaveLength(2);
  });

  it('formats paths', () => {
    expect(formatPath([])).toBe('config');
    expect(formatPath(['a', 'b', 0])).toBe('a.b[0]');
  });
});
