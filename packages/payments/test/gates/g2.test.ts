import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lintJsonl } from '../../gates/evidence.js';
import { decideG2, g2Finished, runG2 } from '../../gates/g2/server.js';
import { EXIT_OK, EXIT_REFUSED } from '../../gates/runner.js';

let out: string;
let lines: string[];

beforeEach(() => {
  out = mkdtempSync(join(tmpdir(), 'gavel-g2-test-'));
  lines = [];
});

afterEach(() => {
  rmSync(out, { recursive: true, force: true });
});

function run(argv: string[]) {
  return runG2({
    argv: ['--fake', '--out', out, ...argv],
    env: { PAYPAL_ENV: 'sandbox' },
    log: (m) => lines.push(m),
  });
}

describe('decideG2 (SPEC 7.3)', () => {
  const ok = { outcome: 'authorized' as const, orderId: 'O', authId: 'A' };
  it('passes when wallet and card are authorized', () => {
    expect(decideG2({ wallet: ok, card: ok }).decision).toBe('PASS');
  });
  it('passes with fallback when the card path is not offered or fails', () => {
    expect(decideG2({ wallet: ok, card: { outcome: 'not_offered' } }).decision).toBe(
      'PASS-WITH-FALLBACK',
    );
    expect(decideG2({ wallet: ok, card: { outcome: 'error' } }).decision).toBe(
      'PASS-WITH-FALLBACK',
    );
  });
  it('fails when the wallet path does not authorize', () => {
    expect(decideG2({ wallet: { outcome: 'error' }, card: ok }).decision).toBe('FAIL');
    expect(decideG2({ card: ok }).decision).toBe('FAIL');
  });
  it('finishes only when both paths are final', () => {
    expect(g2Finished({ wallet: ok })).toBe(false);
    expect(g2Finished({ wallet: ok, card: { outcome: 'cancelled' } })).toBe(false);
    expect(g2Finished({ wallet: ok, card: { outcome: 'not_offered' } })).toBe(true);
  });
});

describe('G2 against the fake (T-PAY-091)', () => {
  it('records order and authorization ids for wallet and card', async () => {
    const code = await run([]);
    expect(code).toBe(EXIT_OK);
    const gates = readFileSync(join(out, 'GATES.md'), 'utf8');
    expect(gates).toContain('## G2 card and guest AUTHORIZE');
    expect(gates).toContain('Decision: PASS');
    expect(gates).toMatch(/G2 wallet AUTHORIZE \| .*authorization /);
    const dir = join(out, 'G2');
    const file = readdirSync(dir).find((f) => f.endsWith('.jsonl')) ?? '';
    const text = readFileSync(join(dir, file), 'utf8');
    expect(lintJsonl(text)).toEqual([]);
    const ids = text
      .split('\n')
      .filter((l) => l.includes('order and authorization ids'))
      .map((l) => JSON.parse(l) as { buyer: string });
    expect(ids.map((r) => r.buyer).sort()).toEqual(['card', 'wallet']);
  });

  it('card not offered: PASS-WITH-FALLBACK', async () => {
    const code = await run(['--fake-card', 'not-offered']);
    expect(code).toBe(EXIT_OK);
    expect(readFileSync(join(out, 'GATES.md'), 'utf8')).toContain('Decision: PASS-WITH-FALLBACK');
  });

  it('refuses a bad flag value', async () => {
    expect(await run(['--fake-card', 'maybe'])).toBe(EXIT_REFUSED);
    expect(await run(['--port', 'x'])).toBe(EXIT_REFUSED);
  });
});
