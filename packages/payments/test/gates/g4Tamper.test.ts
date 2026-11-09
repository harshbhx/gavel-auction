import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_DELIVERIES,
  TAMPER_CASES,
  buildCases,
  changeAmount,
  changeCharAt,
  changeOneByte,
  isRefusal,
  markdownSummary,
  pickDeliveries,
  runTamper,
  tamperVerdict,
  type CaseResult,
} from '../../gates/g4-tamper.js';
import { EXIT_OK, EXIT_REFUSED } from '../../gates/runner.js';
import { lintJsonl } from '../../gates/evidence.js';

const fixture = (name: string): string =>
  readFileSync(new URL(`../fixtures/webhooks/${name}`, import.meta.url), 'utf8');

const headers = {
  'PAYPAL-TRANSMISSION-ID': 'abc-123',
  'PAYPAL-TRANSMISSION-SIG': 'c2lnbmF0dXJl',
  'PAYPAL-TRANSMISSION-TIME': '2026-11-05T01:20:41Z',
  'PAYPAL-CERT-URL': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1',
  'PAYPAL-AUTH-ALGO': 'SHA256withRSA',
};

let out: string;
let lines: string[];
beforeEach(() => {
  out = mkdtempSync(join(tmpdir(), 'gavel-g4t-'));
  lines = [];
});
afterEach(() => rmSync(out, { recursive: true, force: true }));
const log = (m: string): void => {
  lines.push(m);
};

describe('tamper helpers', () => {
  it('changeCharAt always changes exactly one character', () => {
    for (const ch of ['0', 'a', 'A', '7', 'z']) {
      const s = `x${ch}y`;
      const t = changeCharAt(s, 1);
      expect(t).toHaveLength(3);
      expect(t).not.toBe(s);
      expect(t[0]).toBe('x');
      expect(t[2]).toBe('y');
    }
  });

  it('changes one character of a real event and keeps it valid JSON', () => {
    const raw = fixture('payment-capture-completed-01.json');
    const t = changeOneByte(raw);
    expect(t).toHaveLength(raw.length);
    let diff = 0;
    for (let i = 0; i < raw.length; i += 1) if (raw[i] !== t[i]) diff += 1;
    expect(diff).toBe(1);
    expect(() => JSON.parse(t)).not.toThrow();
  });

  it('changes the amount of a real event, and returns nothing without one', () => {
    const raw = fixture('payment-capture-completed-01.json');
    const t = changeAmount(raw) ?? '';
    expect(t).not.toBe(raw);
    expect(JSON.parse(t).resource.amount.value).not.toBe('1.00');
    expect(changeAmount('{"id":"WH-1","resource":{"id":"X"}}')).toBeUndefined();
    expect(changeAmount('{"resource":{"amountCents":350}}')).toContain('"amountCents":1127');
  });

  it('builds the five cases with the right single change each', () => {
    const raw = fixture('payment-capture-completed-01.json');
    const c = buildCases({ headers, rawBody: raw }, 'other-id');
    if ('error' in c) throw new Error(c.error);
    expect(Object.keys(c)).toEqual([...TAMPER_CASES]);
    expect(c.control?.rawEvent).toBe(raw);
    expect(c.control?.headers).toEqual(headers);
    expect(c.foreign_transmission_id?.headers['PAYPAL-TRANSMISSION-ID']).toBe('other-id');
    expect(c.foreign_transmission_id?.rawEvent).toBe(raw);
    expect(c.signature?.headers['PAYPAL-TRANSMISSION-SIG']).not.toBe(
      headers['PAYPAL-TRANSMISSION-SIG'],
    );
    expect(c.signature?.rawEvent).toBe(raw);
    expect(c.body_byte?.headers).toEqual(headers);
  });

  it('never reuses its own transmission id as the foreign one', () => {
    const c = buildCases(
      { headers, rawBody: '{"id":"WH-1","create_time":"2026-11-05T01:20:41Z"}' },
      'abc-123',
    );
    if ('error' in c) throw new Error(c.error);
    expect(c.foreign_transmission_id?.headers['PAYPAL-TRANSMISSION-ID']).not.toBe('abc-123');
    expect(c.amount).toBeUndefined();
  });

  it('reports a delivery it cannot build cases for', () => {
    expect(buildCases({ headers, rawBody: 'nope' }, '')).toEqual({
      error: 'delivery is not a single JSON event',
    });
    expect(buildCases({ headers: {}, rawBody: '{}' }, '')).toEqual({
      error: 'delivery has no signature header',
    });
  });
});

const r = (c: CaseResult['case'], http: number, verification: string): CaseResult => ({
  eventType: 'PAYMENT.CAPTURE.COMPLETED',
  case: c,
  http,
  verification,
});

describe('verdict', () => {
  it('counts FAILURE and HTTP errors as refusals, SUCCESS as not', () => {
    expect(isRefusal({ http: 200, verification: 'FAILURE' })).toBe(true);
    expect(isRefusal({ http: 400, verification: '' })).toBe(true);
    expect(isRefusal({ http: 0, verification: 'MALFORMED' })).toBe(true);
    expect(isRefusal({ http: 200, verification: 'SUCCESS' })).toBe(false);
    expect(isRefusal({ http: 200, verification: '' })).toBe(false);
  });

  it('is PASS only when the control verifies and every tampered case is refused', () => {
    const ok = [r('control', 200, 'SUCCESS'), r('body_byte', 200, 'FAILURE'), r('amount', 400, '')];
    expect(tamperVerdict(ok)).toBe('PASS');
    expect(tamperVerdict([...ok, r('signature', 200, 'SUCCESS')])).toBe('FAIL');
  });

  it('is INCONCLUSIVE when the control does not verify or nothing was tried', () => {
    expect(tamperVerdict([r('control', 200, 'FAILURE'), r('body_byte', 200, 'FAILURE')])).toBe(
      'INCONCLUSIVE',
    );
    expect(tamperVerdict([])).toBe('INCONCLUSIVE');
    expect(tamperVerdict([r('control', 200, 'SUCCESS')])).toBe('INCONCLUSIVE');
  });

  it('renders every result in the markdown table', () => {
    const md = markdownSummary('PASS', [r('control', 200, 'SUCCESS'), r('amount', 200, 'FAILURE')]);
    expect(md).toContain('# G4 tamper run: PASS');
    expect(md).toContain('| PAYMENT.CAPTURE.COMPLETED | amount | 200 | FAILURE |');
  });
});

describe('pickDeliveries', () => {
  const mk = (
    type: string,
    id: string,
    res: string,
  ): { headers: typeof headers; rawBody: string } => ({
    headers,
    rawBody: JSON.stringify({ id, event_type: type, resource: { id: res } }),
  });
  const all = [
    mk('CHECKOUT.ORDER.APPROVED', 'WH-1', 'O1'),
    mk('PAYMENT.AUTHORIZATION.VOIDED', 'WH-2', 'A1'),
    mk('PAYMENT.CAPTURE.COMPLETED', 'WH-3', 'C1'),
    mk('PAYMENT.CAPTURE.COMPLETED', 'WH-4', 'C-old'),
  ];
  it('prefers capture then void, at most the limit', () => {
    const p = pickDeliveries(all, undefined, MAX_DELIVERIES);
    expect(p).toHaveLength(2);
    expect(p[0]?.rawBody).toContain('WH-3');
    expect(p[1]?.rawBody).toContain('WH-2');
  });
  it('keeps only events of this run when ids are given', () => {
    const p = pickDeliveries(all, { 'PAYMENT.CAPTURE.COMPLETED': ['C-old'] }, 5);
    expect(p).toHaveLength(1);
    expect(p[0]?.rawBody).toContain('WH-4');
  });
});

describe('G4 tamper against the fake verify endpoint', () => {
  it('passes: the control verifies and every tampered case is refused', async () => {
    const code = await runTamper({ argv: ['--fake', '--out', out], env: {}, log });
    expect(lines.join('\n')).toContain('G4 TAMPER VERDICT: PASS');
    expect(code).toBe(EXIT_OK);
    const dir = join(out, 'G4-tamper');
    const files = readdirSync(dir);
    const jsonl = files.find((f) => f.endsWith('.jsonl')) ?? '';
    const text = readFileSync(join(dir, jsonl), 'utf8');
    expect(lintJsonl(text)).toEqual([]);
    expect(text).not.toContain('transmission_sig');
    const summary = JSON.parse(readFileSync(join(dir, 'tamper-summary.json'), 'utf8'));
    expect(summary.verdict).toBe('PASS');
    expect(summary.results.some((x: CaseResult) => x.case === 'control')).toBe(true);
    expect(readFileSync(join(dir, 'tamper-summary.sha256'), 'utf8')).toMatch(/^[0-9a-f]{64} {2}/);
  });

  it('refuses a real run without a log file', async () => {
    const code = await runTamper({ argv: ['--out', out], env: { PAYPAL_ENV: 'sandbox' }, log });
    expect(code).toBe(EXIT_REFUSED);
  });
});
