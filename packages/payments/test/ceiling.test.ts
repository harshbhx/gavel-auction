import { describe, expect, it } from 'vitest';
import { validateCeiling } from '../src/ceiling.js';
import { PayPalError } from '../src/errors.js';

const rules = { maxCeilingCents: 25000, presetsCents: [1, 25000] };

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
  it('refuses 0, -1, 25001 and accepts 25000, 1', () => {
    const results = [0, -1, 25001, 25000, 1].map((c) => refused(() => validateCeiling(c, rules)));
    expect(results).toEqual([true, true, true, false, false]);
  });

  it('refuses non-integers and non-finite values', () => {
    for (const c of [1.5, NaN, Infinity, -Infinity]) {
      expect(
        refused(() => validateCeiling(c, rules)),
        String(c),
      ).toBe(true);
    }
  });

  it('enforces the presets passed in by the caller', () => {
    const r = { maxCeilingCents: 25000, presetsCents: [5000, 10000] };
    expect(validateCeiling(5000, r)).toBe(5000);
    expect(refused(() => validateCeiling(7500, r))).toBe(true);
    expect(refused(() => validateCeiling(1, { ...r, presetsCents: [] }))).toBe(true);
  });

  it('fails closed when the presets are omitted by a caller that bypasses the type', () => {
    const noPresets = { maxCeilingCents: 25000 } as unknown as Parameters<
      typeof validateCeiling
    >[1];
    expect(refused(() => validateCeiling(24999, noPresets))).toBe(true);
    expect(refused(() => validateCeiling(5000, noPresets))).toBe(true);
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
