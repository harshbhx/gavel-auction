import { describe, expect, it } from 'vitest';
import { confidenceToBps } from '../../src/commands.js';
import {
  DEFAULT_AUCTION_CONFIG,
  validateAuctionConfig,
  validateLotConfig,
} from '../../src/config.js';
import { CEILING_PRESETS_CENTS, DEFAULT_MAX_CEILING_CENTS } from '../../src/policy.js';
import { REJECT_REASONS } from '../../src/reasons.js';
import { MAX_AMOUNT_CENTS } from '../../src/types.js';
import { toBps } from '../../../shared/src/confidence';
import {
  AUCTION_MODES,
  AuctionConfigSchema,
  MAX_CEILING_PRESETS,
  MAX_EXTENSIONS_LIMIT,
  MAX_SOFT_CLOSE_EXTENSION_MS,
  MIN_RESERVE_CENTS,
} from '../../../shared/src/config-schema';
import { ERROR_CODES } from '../../../shared/src/errors';
import { MAX_CENTS, isCents } from '../../../shared/src/money';
import { L1, lotConfig } from '../decide-helpers.js';

/**
 * Contract with @gavel/shared (R-ENG-028). The two packages are developed apart, so every
 * place where they must agree is pinned here and a drift fails this file.
 */

describe('contract with shared: reject reasons', () => {
  it('T-ENG-022 R-ENG-028 R-ENG-125: every engine reject reason is a shared error code of the same name', () => {
    const wire: readonly string[] = ERROR_CODES;
    expect(REJECT_REASONS.filter((r) => !wire.includes(r))).toEqual([]);
  });

  it('T-ENG-022 R-ENG-028: REJECT_REASONS has no duplicates', () => {
    expect(new Set(REJECT_REASONS).size).toBe(REJECT_REASONS.length);
  });
});

describe('contract with shared: config and money', () => {
  it('T-ENG-009 R-ENG-009: engine defaults match the shared confidence unit and presets', () => {
    expect(validateAuctionConfig({})).toEqual({ ok: true, value: DEFAULT_AUCTION_CONFIG });
    // The engine gate threshold is the shared 0.85 confidence expressed in basis points.
    expect(DEFAULT_AUCTION_CONFIG.confirmBelowBps).toBe(toBps(0.85));
    expect(DEFAULT_AUCTION_CONFIG.maxCeilingCents).toBe(DEFAULT_MAX_CEILING_CENTS);
    expect(CEILING_PRESETS_CENTS.length).toBeLessThanOrEqual(MAX_CEILING_PRESETS);
    for (const p of CEILING_PRESETS_CENTS) expect(isCents(p)).toBe(true);
  });

  it('T-ENG-009 R-ENG-009: confidence conversion agrees with shared on a sweep', () => {
    for (let i = 0; i <= 1000; i += 1) {
      const c = i / 1000;
      expect(confidenceToBps(c)).toBe(toBps(c));
    }
  });

  it('T-ENG-009 R-ENG-009: the engine accepts the shared limits and refuses one step past them', () => {
    const soft = (extensionMs: number, maxExtensions: number) =>
      validateLotConfig(
        lotConfig(L1, { softClose: { windowMs: 30000, extensionMs, maxExtensions } }),
      );
    expect(soft(MAX_SOFT_CLOSE_EXTENSION_MS, MAX_EXTENSIONS_LIMIT).ok).toBe(true);
    expect(soft(MAX_SOFT_CLOSE_EXTENSION_MS + 1, 0).ok).toBe(false);
    expect(soft(30000, MAX_EXTENSIONS_LIMIT + 1).ok).toBe(false);
    expect(validateLotConfig(lotConfig(L1, { reserveCents: MIN_RESERVE_CENTS })).ok).toBe(true);
  });

  it('T-ENG-009 R-ENG-009: the engine mode set contains the shared modes and money fits shared cents', () => {
    const engineModes = ['english', 'proxy', 'second_price'];
    expect([...AUCTION_MODES].sort()).toEqual([...engineModes].sort());
    expect(MAX_AMOUNT_CENTS).toBeLessThanOrEqual(MAX_CENTS);
    expect(isCents(MAX_AMOUNT_CENTS)).toBe(true);
  });
});

describe('contract with shared: config schema', () => {
  const base = {
    currency: 'USD',
    reserve: 10000,
    minIncrement: 500,
    endTs: 1_789_000_000_000,
    softCloseWindowMs: 30_000,
    softCloseExtensionMs: 30_000,
    maxExtensions: 10,
    ceilingPresets: [50000],
    confirmConfidenceThreshold: 0.85,
  };

  it('T-ENG-009 R-ENG-028: the shared schema accepts every engine mode, hold scope and a ladder', () => {
    for (const mode of AUCTION_MODES) {
      expect(AuctionConfigSchema.safeParse({ ...base, mode }).success).toBe(true);
    }
    for (const holdScope of ['event', 'lot']) {
      expect(AuctionConfigSchema.safeParse({ ...base, holdScope }).success).toBe(true);
      expect(validateAuctionConfig({ holdScope }).ok).toBe(true);
    }
    const ladder = [
      { fromCents: 0, incrementCents: 100 },
      { fromCents: 10000, incrementCents: 500 },
    ];
    expect(AuctionConfigSchema.safeParse({ ...base, incrementLadder: ladder }).success).toBe(true);
    expect(validateLotConfig(lotConfig(L1, { increment: { ladder } })).ok).toBe(true);
  });

  it('T-ENG-009 R-ENG-028: the shared schema refuses a ladder the engine refuses', () => {
    const bad = [
      { fromCents: 100, incrementCents: 100 },
      { fromCents: 50, incrementCents: 100 },
    ];
    expect(AuctionConfigSchema.safeParse({ ...base, incrementLadder: bad }).success).toBe(false);
    expect(validateLotConfig(lotConfig(L1, { increment: { ladder: bad } })).ok).toBe(false);
    expect(AuctionConfigSchema.safeParse({ ...base, holdScope: 'room' }).success).toBe(false);
  });
});
