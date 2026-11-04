import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { G1_AUTHORIZE_CENTS, runG1 } from '../../gates/g1.js';
import { amount, gateCurrency } from '../../gates/gateUtil.js';

describe('gate currency', () => {
  it('defaults to INR and reads GATE_CURRENCY', () => {
    expect(gateCurrency({})).toBe('INR');
    expect(gateCurrency({ GATE_CURRENCY: ' ' })).toBe('INR');
    expect(gateCurrency({ GATE_CURRENCY: 'usd' })).toBe('USD');
  });

  it('builds amounts in the gate currency', () => {
    expect(amount(50000, 'INR')).toEqual({ currency_code: 'INR', value: '500.00' });
    expect(amount(35000, 'USD')).toEqual({ currency_code: 'USD', value: '350.00' });
  });
});

describe('G1 order body', () => {
  let out = '';
  afterEach(() => {
    vi.restoreAllMocks();
    if (out !== '') rmSync(out, { recursive: true, force: true });
  });

  async function orderBodies(env: Record<string, string>): Promise<unknown[]> {
    out = mkdtempSync(join(tmpdir(), 'gavel-g1-currency-'));
    const bodies: unknown[] = [];
    const real = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/v2/checkout/orders') && typeof init?.body === 'string') {
        bodies.push(JSON.parse(init.body));
      }
      return real(input, init);
    });
    await runG1({
      argv: ['--fake', '--out', out],
      env: { PAYPAL_ENV: 'sandbox', ...env },
      log: () => undefined,
    });
    return bodies;
  }

  it('sends INR by default', async () => {
    const bodies = await orderBodies({});
    expect(bodies.length).toBeGreaterThan(0);
    expect(JSON.stringify(bodies[0])).toContain('"currency_code":"INR","value":"500.00"');
    expect(G1_AUTHORIZE_CENTS).toBe(50000);
  });

  it('sends USD when GATE_CURRENCY=USD', async () => {
    const bodies = await orderBodies({ GATE_CURRENCY: 'USD' });
    expect(JSON.stringify(bodies[0])).toContain('"currency_code":"USD","value":"500.00"');
  });
});
