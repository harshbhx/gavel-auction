import { describe, expect, it } from 'vitest';
import { validateAuctionConfig, validateLotConfig, validateRegisterScope } from '../src/config.js';

const LOT = '01JC00000000000000000002M1';
const okLot = {
  lotId: LOT,
  title: 'Painting',
  mode: 'english',
  reserveCents: 1000,
  durationMs: 60000,
};

describe('config', () => {
  it('T-ENG-008 (R-ENG-008, R-ENG-010): reports all errors without throwing', () => {
    const r = validateLotConfig({
      ...okLot,
      reserveCents: 0,
      increment: { ladder: [{ fromCents: 100, incrementCents: 0 }] },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.path)).toEqual([
        'reserveCents',
        'increment.ladder[0].fromCents',
        'increment.ladder[0].incrementCents',
      ]);
    }
  });

  it('T-ENG-009 (R-ENG-009): defaults table', () => {
    const a = validateAuctionConfig({});
    expect(a).toEqual({
      ok: true,
      value: {
        currency: 'USD',
        holdScope: 'event',
        maxCeilingCents: 10_000_000,
        confirmBelowBps: 8500,
        fallbackPolicy: 'runner_up',
        maxFallbackDepth: 2,
      },
    });
    const l = validateLotConfig(okLot);
    expect(l.ok && l.value.increment).toEqual({ flatCents: 100 });
    expect(l.ok && l.value.softClose.maxExtensions).toBe(10);
    expect(l.ok && l.value.softClose.windowMs).toBe(0);
    expect(l.ok && l.value.hammer).toBe('auto');
  });

  it('R-ENG-002: non-USD currency fails unsupported_currency', () => {
    const r = validateAuctionConfig({ currency: 'EUR' });
    expect(!r.ok && r.errors[0]?.code).toBe('unsupported_currency');
  });

  it('T-ENG-010 (R-ENG-011): second_price with soft close fails', () => {
    const r = validateLotConfig({
      ...okLot,
      mode: 'second_price',
      softClose: { windowMs: 30000, extensionMs: 30000, maxExtensions: 3 },
    });
    expect(!r.ok && r.errors.map((e) => e.code)).toContain('soft_close_not_allowed_sealed');
  });

  it('T-ENG-011 (R-ENG-012): bounds', () => {
    const bad = (o: object): boolean => !validateLotConfig({ ...okLot, ...o }).ok;
    expect(bad({ softClose: { windowMs: 600001 } })).toBe(true);
    expect(bad({ softClose: { extensionMs: -1 } })).toBe(true);
    expect(bad({ softClose: { maxExtensions: 51 } })).toBe(true);
    expect(bad({ durationMs: 999 })).toBe(true);
    expect(bad({ softClose: { hardCloseMs: 59999 } })).toBe(true);
    expect(bad({ softClose: { hardCloseMs: 60000, windowMs: 600000, maxExtensions: 50 } })).toBe(
      false,
    );
  });

  it('R-ENG-010: ladder must start at 0 and strictly increase', () => {
    const l = (ladder: unknown): boolean =>
      validateLotConfig({ ...okLot, increment: { ladder } }).ok;
    expect(
      l([
        { fromCents: 0, incrementCents: 100 },
        { fromCents: 5000, incrementCents: 500 },
      ]),
    ).toBe(true);
    expect(
      l([
        { fromCents: 0, incrementCents: 100 },
        { fromCents: 0, incrementCents: 500 },
      ]),
    ).toBe(false);
    expect(l([])).toBe(false);
    expect(validateLotConfig({ ...okLot, increment: { flatCents: 0 } }).ok).toBe(false);
  });

  it('T-ENG-012 (R-ENG-013): lotId iff holdScope lot', () => {
    expect(validateRegisterScope('lot', {}).ok).toBe(false);
    expect(validateRegisterScope('event', { lotId: LOT }).ok).toBe(false);
    expect(validateRegisterScope('lot', { lotId: LOT }).ok).toBe(true);
    expect(validateRegisterScope('event', {}).ok).toBe(true);
    const r = validateRegisterScope('lot', {});
    expect(!r.ok && r.errors[0]?.code).toBe('bad_command');
  });

  it('never throws on garbage', () => {
    for (const x of [null, 5, 'x', [], { mode: {} }]) {
      expect(() => validateLotConfig(x)).not.toThrow();
    }
  });
});
