import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lintJsonl, lintTokens, redact } from '../../gates/evidence.js';
import { decideG1, runG1, summarizeDecisions, type G1Observed } from '../../gates/g1.js';
import { EXIT_OK, EXIT_REFUSED } from '../../gates/runner.js';

let out: string;
let lines: string[];

beforeEach(() => {
  out = mkdtempSync(join(tmpdir(), 'gavel-g1-test-'));
  lines = [];
});

afterEach(() => {
  rmSync(out, { recursive: true, force: true });
});

function run(argv: string[], env: Record<string, string | undefined> = {}) {
  return runG1({
    argv: ['--fake', '--out', out, ...argv],
    env: { PAYPAL_ENV: 'sandbox', ...env },
    log: (m) => lines.push(m),
  });
}

function evidenceRecords(): Array<{ step: string; buyer?: string; assertion?: { pass: boolean } }> {
  const dir = join(out, 'G1');
  const file = readdirSync(dir).find((f) => f.endsWith('.jsonl')) ?? '';
  const text = readFileSync(join(dir, file), 'utf8');
  expect(lintJsonl(text)).toEqual([]);
  return text
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => JSON.parse(l) as { step: string; buyer?: string; assertion?: { pass: boolean } });
}

function obs(buyer: 'wallet' | 'card', decision: G1Observed['decision']): G1Observed {
  return {
    buyer,
    orderId: 'O',
    authId: 'A',
    authStatusBefore: 'CREATED',
    captureHttp: decision === 'FAIL' ? 422 : 201,
    captureStatus: 'COMPLETED',
    captureFinal: true,
    authStatusAfterCapture: decision === 'A' ? 'CAPTURED' : 'PARTIALLY_CAPTURED',
    orderStatusAfterCapture: 'COMPLETED',
    voidHttp: decision === 'B' ? 201 : 422,
    voidName: '',
    authStatusAfterVoid: 'VOIDED',
    remainderOpen: decision !== 'A',
    decision,
  };
}

describe('decideG1 (SPEC 7.3)', () => {
  it('maps observations to A, B, C and FAIL', () => {
    expect(
      decideG1({ captureHttp: 201, authStatusAfterCapture: 'CAPTURED', voidHttp: 422 }),
    ).toEqual({ decision: 'A', remainderOpen: false });
    // The authorization reads CAPTURED but the void is accepted: the remainder was still held.
    expect(
      decideG1({ captureHttp: 201, authStatusAfterCapture: 'CAPTURED', voidHttp: 201 }),
    ).toEqual({ decision: 'B', remainderOpen: true });
    expect(
      decideG1({ captureHttp: 201, authStatusAfterCapture: 'PARTIALLY_CAPTURED', voidHttp: 201 }),
    ).toEqual({ decision: 'B', remainderOpen: true });
    expect(
      decideG1({ captureHttp: 201, authStatusAfterCapture: 'CREATED', voidHttp: 422 }),
    ).toEqual({ decision: 'C', remainderOpen: true });
    expect(
      decideG1({ captureHttp: 422, authStatusAfterCapture: 'CREATED', voidHttp: 0 }).decision,
    ).toBe('FAIL');
  });
});

describe('summarizeDecisions', () => {
  it('passes when every buyer is A', () => {
    const s = summarizeDecisions([obs('wallet', 'A'), obs('card', 'A')]);
    expect(s.decision).toBe('PASS');
    expect(s.fallback).toBe('');
  });
  it('is PASS-WITH-FALLBACK for B', () => {
    expect(summarizeDecisions([obs('wallet', 'B')]).decision).toBe('PASS-WITH-FALLBACK');
  });
  it('falls back to wallet only when the card buyer fails', () => {
    const s = summarizeDecisions([obs('wallet', 'A'), obs('card', 'FAIL')]);
    expect(s.decision).toBe('PASS-WITH-FALLBACK');
    expect(s.fallback).toContain('wallet buyers only');
  });
  it('fails when the wallet buyer ends in C or FAIL', () => {
    expect(summarizeDecisions([obs('wallet', 'C')]).decision).toBe('FAIL');
    expect(summarizeDecisions([obs('wallet', 'FAIL')]).decision).toBe('FAIL');
  });
});

describe('G1 against the fake (T-PAY-079)', () => {
  it('released remainder: decision A for wallet and card, entry appended', async () => {
    const code = await run(['--fake-remainder', 'released']);
    expect(code).toBe(EXIT_OK);
    expect(lines.some((l) => l.includes('G1 decision: wallet=A, card=A'))).toBe(true);
    const gates = readFileSync(join(out, 'GATES.md'), 'utf8');
    expect(gates).toContain('## G1 partial capture and remainder');
    expect(gates).toContain('Decision: PASS');
    expect(gates).toContain('Buyers: wallet, card');
    const records = evidenceRecords();
    expect(records.some((r) => r.step === 'G1.5 capture 350 final' && r.buyer === 'card')).toBe(
      true,
    );
    expect(records.some((r) => r.step === 'G1.5 capture 350 final' && r.buyer === 'wallet')).toBe(
      true,
    );
    expect(records.every((r) => r.assertion === undefined || r.assertion.pass)).toBe(true);
  });

  it('open remainder: the fake reads CAPTURED but accepts the void, so the decision is B', async () => {
    const code = await run(['--fake-remainder', 'open']);
    expect(code).toBe(EXIT_OK);
    expect(lines.some((l) => l.includes('G1 decision: wallet=B, card=B'))).toBe(true);
    expect(readFileSync(join(out, 'GATES.md'), 'utf8')).toContain('Decision: PASS-WITH-FALLBACK');
  });
});

describe('G1 refusals', () => {
  it('names the missing buyer secrets and never prints a value', async () => {
    const code = await runG1({
      argv: ['--browser', '--out', out],
      env: {
        PAYPAL_ENV: 'sandbox',
        PAYPAL_CLIENT_ID: 'id-value-1',
        PAYPAL_CLIENT_SECRET: 'sec-v1',
        SANDBOX_BUYER_EMAIL: '',
      },
      log: (m) => lines.push(m),
    });
    expect(code).toBe(EXIT_REFUSED);
    const text = lines.join('\n');
    expect(text).toContain('SANDBOX_BUYER_EMAIL, SANDBOX_BUYER_PASSWORD');
    expect(text).not.toContain('sec-v1');
  });

  it('rejects an unknown remainder mode', async () => {
    const code = await run(['--fake-remainder', 'maybe']);
    expect(code).toBe(EXIT_REFUSED);
  });

  it('refuses a non-sandbox environment', async () => {
    const code = await run([], { PAYPAL_ENV: 'live' });
    expect(code).toBe(EXIT_REFUSED);
  });
});

describe('personal fields in evidence (PAYMENTS-R2-12)', () => {
  it('redacts payer and merchant fields and the extra token keys', () => {
    const r = redact({
      payer: {
        email_address: 'buyer@example.test',
        name: { given_name: 'A', surname: 'B' },
        payer_id: 'P1',
      },
      payee: { merchant_id: 'M1', email_address: 'seller@example.test' },
      shipping: { address: { address_line_1: '1 Road', postal_code: '1' } },
      refresh_token: 'x',
      id_token: 'y',
      token: 'z',
    });
    expect(JSON.stringify(r)).not.toMatch(/example\.test|1 Road|"P1"|"M1"/);
  });

  it('lint accepts a long upper-case issue name but still rejects a mixed-case token', () => {
    expect(
      lintTokens({ name: 'UNPROCESSABLE_ENTITY AUTHORIZATION_NOT_HONORED_AFTER_HONOR_PERIOD' }),
    ).toEqual([]);
    expect(lintTokens({ note: 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789AbCdEf' })).toEqual(['note']);
  });

  it('lint rejects an email-shaped value that was not redacted', () => {
    expect(lintTokens({ note: 'contact buyer@example.test' })).toEqual(['note']);
  });
});
