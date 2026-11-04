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

/** Engine reasons that have a different name on the wire. */
const RENAMED_ON_THE_WIRE: Readonly<Record<string, string>> = { lot_not_open: 'closed' };

/** Engine reasons the wire has no code for yet; the server maps them before they reach a client. */
const ENGINE_ONLY_REASONS = [
  'ceiling_revoked',
  'unconfirmed',
  'not_higher_than_own_max',
  'already_bid',
  'limit_exceeded',
] as const;

describe('contract with shared: reject reasons', () => {
  it('T-ENG-022 R-ENG-028: every engine reason is a shared error code, renamed, or listed as engine only', () => {
    const wire: readonly string[] = ERROR_CODES;
    const unaccounted = REJECT_REASONS.filter(
      (r) =>
        !wire.includes(r) &&
        RENAMED_ON_THE_WIRE[r] === undefined &&
        !(ENGINE_ONLY_REASONS as readonly string[]).includes(r),
    );
    expect(unaccounted).toEqual([]);
  });

  it('T-ENG-022 R-ENG-028: renamed reasons point at a shared code and engine only reasons are not on the wire', () => {
    const wire: readonly string[] = ERROR_CODES;
    for (const [reason, code] of Object.entries(RENAMED_ON_THE_WIRE)) {
      expect(REJECT_REASONS as readonly string[]).toContain(reason);
      expect(wire).toContain(code);
    }
    for (const reason of ENGINE_ONLY_REASONS) {
      expect(REJECT_REASONS as readonly string[]).toContain(reason);
      expect(wire).not.toContain(reason);
    }
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
    for (const m of AUCTION_MODES) expect(engineModes).toContain(m);
    expect(MAX_AMOUNT_CENTS).toBeLessThanOrEqual(MAX_CENTS);
    expect(isCents(MAX_AMOUNT_CENTS)).toBe(true);
  });
});
