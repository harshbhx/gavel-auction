import { describe, expect, it } from 'vitest';
import { AuctionConfigSchema } from '../src/config-schema';

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
