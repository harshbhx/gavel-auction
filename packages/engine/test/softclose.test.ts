import { describe, expect, it } from 'vitest';
import { extension } from '../src/rules/softclose.js';
import { newLot } from '../src/state.js';
import type { LotState } from '../src/state.js';
import type { LotConfig, SoftClose, Ulid } from '../src/types.js';

function mk(
  sc: SoftClose,
  over: Partial<LotState> = {},
  mode: LotConfig['mode'] = 'english',
): LotState {
  const config: LotConfig = {
    lotId: 'L' as Ulid,
    title: 't',
    mode,
    reserveCents: 100,
    increment: { flatCents: 100 },
    durationMs: 100000,
    softClose: sc,
    hammer: 'auto',
  };
  return { ...newLot('L' as Ulid, config), status: 'OPEN', openedAt: 0, endsAt: 100000, ...over };
}

const sc: SoftClose = { windowMs: 30000, extensionMs: 30000, maxExtensions: 3 };

describe('softclose', () => {
  it('T-ENG-027 R-ENG-034 R-ENG-035: exact window boundaries', () => {
    const lot = mk(sc);
    expect(extension(lot, 69999)).toEqual({ endsAt: 100000, extended: false });
    expect(extension(lot, 70000)).toEqual({ endsAt: 100000, extended: true });
    expect(extension(lot, 99999)).toEqual({ endsAt: 129999, extended: true });
  });

  it('R-ENG-034: disabled when window or extension is zero', () => {
    expect(extension(mk({ ...sc, windowMs: 0 }), 99999).extended).toBe(false);
    expect(extension(mk({ ...sc, extensionMs: 0 }), 99999).extended).toBe(false);
  });

  it('T-ENG-028 R-ENG-036: caps extension count and hard close', () => {
    const cfg: SoftClose = { ...sc, hardCloseMs: 120000 };
    let lot = mk(cfg);
    let extended = 0;
    for (let i = 0; i < 6; i++) {
      const r = extension(lot, (lot.endsAt ?? 0) - 1);
      expect(r.endsAt).toBeLessThanOrEqual(120000);
      if (r.extended) {
        extended += 1;
        lot = { ...lot, endsAt: r.endsAt, extensions: lot.extensions + 1 };
      }
    }
    expect(extended).toBe(3);
    expect(lot.endsAt).toBe(120000);
  });

  it('R-ENG-037: second-price lots never extend', () => {
    expect(extension(mk(sc, {}, 'second_price'), 99999).extended).toBe(false);
  });

  it('never extends a lot without an end time or config', () => {
    expect(extension(mk(sc, { endsAt: null }), 1).extended).toBe(false);
    expect(extension(mk(sc, { config: null }), 99999).extended).toBe(false);
  });
});
