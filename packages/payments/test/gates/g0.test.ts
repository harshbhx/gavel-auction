import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runG0 } from '../../gates/g0.js';
import { gateCurrency } from '../../gates/gateUtil.js';
import { EXIT_OK, EXIT_REFUSED } from '../../gates/runner.js';

let out: string;
let lines: string[];

beforeEach(() => {
  out = mkdtempSync(join(tmpdir(), 'gavel-g0-test-'));
  lines = [];
});

afterEach(() => {
  rmSync(out, { recursive: true, force: true });
});

describe('gate g0', () => {
  it('passes against the fake and writes an evidence file', async () => {
    const code = await runG0({
      argv: ['--fake', '--out', out],
      env: { PAYPAL_ENV: 'sandbox' },
      log: (m) => lines.push(m),
    });
    expect(code).toBe(EXIT_OK);
    const files = readdirSync(join(out, 'g0')).filter((f) => f.endsWith('.jsonl'));
    expect(files).toHaveLength(1);
    const text = readFileSync(join(out, 'g0', files[0] ?? ''), 'utf8');
    expect(text).toContain('g0.2 create order');
  });

  it('refuses a live run outside the sandbox before any request', async () => {
    const code = await runG0({
      argv: ['--out', out],
      env: { PAYPAL_ENV: 'live', PAYPAL_CLIENT_ID: 'x', PAYPAL_CLIENT_SECRET: 'y' },
      log: (m) => lines.push(m),
    });
    expect(code).toBe(EXIT_REFUSED);
  });
});

describe('gateCurrency', () => {
  it('defaults to USD, accepts INR and rejects other shapes', () => {
    expect(gateCurrency({})).toBe('USD');
    expect(gateCurrency({ GATE_CURRENCY: '' })).toBe('USD');
    expect(gateCurrency({ GATE_CURRENCY: 'INR' })).toBe('INR');
    expect(() => gateCurrency({ GATE_CURRENCY: 'inr' })).toThrow();
  });
});
