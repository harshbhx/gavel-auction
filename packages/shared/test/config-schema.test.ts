import { describe, expect, it } from 'vitest';
import { AuctionConfigSchema, endsInFuture } from '../src/config-schema';

const valid = {
  currency: 'USD',
  reserve: 10000,
  minIncrement: 500,
  endTs: 1_789_000_000_000,
  softCloseWindowMs: 30_000,
  softCloseExtensionMs: 30_000,
  maxExtensions: 10,
  ceilingPresets: [50000, 100000],
  confirmConfidenceThreshold: 0.85,
};

describe('AuctionConfig (T-RT-010)', () => {
  it('parses a valid config and defaults mode to english', () => {
    const cfg = AuctionConfigSchema.parse(valid);
    expect(cfg.mode).toBe('english');
    expect(cfg.reserve).toBe(10000);
    expect(cfg.autoHammerDelayMs).toBeUndefined();
  });

  it('accepts autoHammerDelayMs', () => {
    expect(AuctionConfigSchema.parse({ ...valid, autoHammerDelayMs: 3000 }).autoHammerDelayMs).toBe(
      3000,
    );
  });

  it('rejects unknown keys (strict)', () => {
    expect(AuctionConfigSchema.safeParse({ ...valid, surprise: true }).success).toBe(false);
  });

  it('rejects currencies other than USD', () => {
    expect(AuctionConfigSchema.safeParse({ ...valid, currency: 'EUR' }).success).toBe(false);
  });

  it('rejects non-integer money and missing fields', () => {
    expect(AuctionConfigSchema.safeParse({ ...valid, reserve: 100.5 }).success).toBe(false);
    const rest: Record<string, unknown> = { ...valid };
    delete rest.reserve;
    expect(AuctionConfigSchema.safeParse(rest).success).toBe(false);
  });
});

describe('AuctionConfig boundaries (R-RT-012)', () => {
  const bad = (patch: Record<string, unknown>) =>
    AuctionConfigSchema.safeParse({ ...valid, ...patch }).success;

  it('rejects a zero reserve and a zero increment', () => {
    expect(bad({ reserve: 0 })).toBe(false);
    expect(bad({ reserve: 99 })).toBe(false);
    expect(bad({ minIncrement: 0 })).toBe(false);
  });

  it('rejects unbounded soft-close extension', () => {
    expect(bad({ softCloseExtensionMs: 4_000_000_000 })).toBe(false);
    expect(bad({ softCloseExtensionMs: 600_000 })).toBe(true);
    expect(bad({ maxExtensions: 1_000_000 })).toBe(false);
    expect(bad({ maxExtensions: 50 })).toBe(true);
  });

  it('requires 1..8 ascending presets at or above the reserve', () => {
    expect(bad({ ceilingPresets: [] })).toBe(false);
    expect(bad({ ceilingPresets: Array.from({ length: 9 }, (_, i) => 10000 + i) })).toBe(false);
    expect(bad({ ceilingPresets: [100000, 50000] })).toBe(false);
    expect(bad({ ceilingPresets: [50000, 50000] })).toBe(false);
    expect(bad({ ceilingPresets: [5000, 50000] })).toBe(false);
    expect(bad({ ceilingPresets: [10000] })).toBe(true);
  });

  it('endsInFuture compares against now', () => {
    expect(endsInFuture({ endTs: 2000 as never }, 1000)).toBe(true);
    expect(endsInFuture({ endTs: 1000 as never }, 1000)).toBe(false);
  });
});
