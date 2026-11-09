import { describe, expect, it } from 'vitest';
import { validateCeiling } from '../src/ceiling.js';
import { DEFAULT_MAX_CEILING_CENTS } from '../src/config.js';
import { PayPalError } from '../src/errors.js';

const rules = { maxCeilingCents: 25000, presetsCents: [100, 25000] };

function refused(fn: () => unknown): boolean {
  try {
    fn();
  } catch (e) {
    if (e instanceof PayPalError && e.kind === 'ceiling_out_of_range' && e.outcome === 'definite') {
      return true;
    }
    throw e;
  }
  return false;
}

/** Stand-in for the processor: counts every call that reaches it. */
class CountingGateway {
  calls = 0;
  createOrder(): void {
    this.calls += 1;
  }
}

/** What a caller does: validate first, only then touch the processor. */
function createHold(gw: CountingGateway, ceiling: number): void {
  validateCeiling(ceiling, rules);
  gw.createOrder();
}

describe('T-PAY-006 ceiling validator', () => {
  it('refuses 0, -1, 99, 25001 and accepts 25000, 100', () => {
    const results = [0, -1, 99, 25001, 25000, 100].map((c) =>
      refused(() => validateCeiling(c, rules)),
    );
    expect(results).toEqual([true, true, true, true, false, false]);
  });

  it('refuses a ceiling below the engine minimum even when it is a listed preset', () => {
    expect(refused(() => validateCeiling(50, { maxCeilingCents: 25000, presetsCents: [50] }))).toBe(
      true,
    );
  });

  it('accepts every engine preset under the default cap', () => {
    const presets = [10000, 25000, 50000, 100000];
    for (const c of presets) {
      expect(
        validateCeiling(c, { maxCeilingCents: DEFAULT_MAX_CEILING_CENTS, presetsCents: presets }),
      ).toBe(c);
    }
  });

  it('refuses non-integers and non-finite values', () => {
    for (const c of [1.5, NaN, Infinity, -Infinity]) {
      expect(
        refused(() => validateCeiling(c, rules)),
        String(c),
      ).toBe(true);
    }
  });

  it('accepts any whole-cent ceiling from the minimum to the cap, listed or not', () => {
    const r = { maxCeilingCents: 25000, presetsCents: [5000, 10000] };
    for (const c of [100, 7500, 12345, 25000]) expect(validateCeiling(c, r)).toBe(c);
    expect(validateCeiling(7500, { maxCeilingCents: 25000 })).toBe(7500);
  });

  it('still applies the cap when a preset exceeds it', () => {
    expect(
      refused(() => validateCeiling(30000, { maxCeilingCents: 25000, presetsCents: [30000] })),
    ).toBe(true);
  });

  it('makes no processor call on refusal', () => {
    const gw = new CountingGateway();
    for (const c of [0, -1, 25001]) {
      expect(refused(() => createHold(gw, c))).toBe(true);
    }
    expect(gw.calls).toBe(0);
    createHold(gw, 25000);
    expect(gw.calls).toBe(1);
  });
});
