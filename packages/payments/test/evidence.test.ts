import { describe, expect, it } from 'vitest';
import { buildRequestId } from '../src/requestId.js';
import { EvidenceRecord, lintJsonl, lintTokens, redact, toJsonlLine } from '../gates/evidence.js';

const base: EvidenceRecord = {
  gate: 'G1',
  runId: 'G1-20261104T101500Z-wallet',
  step: 'G1.4 capture 350 final',
  tsMs: 1762251300000,
  request: {
    method: 'POST',
    url: 'https://api-m.sandbox.paypal.com/v2/payments/authorizations/ID/capture',
    headers: { 'PayPal-Request-Id': 'gate-g1-cap-1', Authorization: 'Bearer abcdefgh12345678' },
    body: { amount: { currency_code: 'USD', value: '3.50' }, final_capture: true },
  },
  response: {
    status: 201,
    headers: { 'PayPal-Debug-Id': 'abc123' },
    body: { status: 'COMPLETED' },
  },
  assertion: { name: 'capture completed', expected: 'COMPLETED', actual: 'COMPLETED', pass: true },
  buyer: 'wallet',
  env: 'sandbox',
  scriptVersion: 'abc1234',
};

describe('evidence (T-PAY-070)', () => {
  it('redacts secret fields', () => {
    const r = redact(base);
    expect(r.request?.headers?.Authorization).toBe('[REDACTED]');
    expect(r.request?.headers?.['PayPal-Request-Id']).toBe('gate-g1-cap-1');
    const nested = redact({ a: { client_secret: 'x', access_token: 'y', ok: 1 } });
    expect(nested).toEqual({
      a: { client_secret: '[REDACTED]', access_token: '[REDACTED]', ok: 1 },
    });
  });

  it('writes clean sorted-key lines that pass lint', () => {
    const line = toJsonlLine(base);
    expect(line).not.toContain('Bearer');
    expect(line.indexOf('"assertion"')).toBeLessThan(line.indexOf('"buyer"'));
    expect(lintJsonl(`${line}\n${line}\n`)).toEqual([]);
  });

  it('rejects a record with a planted token', () => {
    const planted = {
      ...base,
      response: { status: 200, body: { note: 'A21AAKexampleexampleexampleexample1234' } },
    };
    expect(lintTokens(redact(planted))).toEqual(['response.body.note']);
    expect(() => toJsonlLine(planted)).toThrow(/token-shaped/);
    const bad = JSON.stringify(planted);
    const problems = lintJsonl(
      `${JSON.stringify(base).replace('Bearer abcdefgh12345678', '[REDACTED]')}\n${bad}\n`,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]?.line).toBe(2);
  });

  it('accepts the production PayPal-Request-Id and still flags other long tokens', () => {
    const id = buildRequestId({
      auctionId: 'a1',
      op: 'capture',
      holdId: 'h1',
      amountCents: 22000,
      generation: 0,
    });
    const record: EvidenceRecord = {
      ...base,
      request: {
        method: 'POST',
        url: 'https://api-m.sandbox.paypal.com/v2/checkout/orders',
        headers: { 'PayPal-Request-Id': id },
      },
      assertion: { name: 'replay', expected: id, actual: `replayed ${id}`, pass: true },
    };
    expect(lintTokens(record)).toEqual([]);
    expect(() => toJsonlLine(record)).not.toThrow();
    const longToken = 'x'.repeat(44);
    expect(lintTokens({ note: `${id} ${longToken}` })).toEqual(['note']);
  });

  it('flags schema violations and bad json', () => {
    const problems = lintJsonl(`${JSON.stringify({ gate: 'G1' })}\nnot json\n`);
    expect(problems.map((p) => p.line)).toEqual([1, 2]);
    expect(problems[1]?.errors).toEqual(['invalid json']);
  });

  it('redacts payer account ids and cardholder names but keeps error names', () => {
    const order = {
      payment_source: {
        paypal: { account_id: 'ABCD1234', name: { given_name: 'A', surname: 'B' } },
        card: { name: 'Jane Buyer', last_digits: '1111', brand: 'VISA' },
      },
      name: 'UNPROCESSABLE_ENTITY',
      details: [{ issue: 'X' }],
    };
    const r = redact(order);
    const text = JSON.stringify(r);
    expect(text).not.toContain('ABCD1234');
    expect(text).not.toContain('Jane Buyer');
    expect(r.name).toBe('UNPROCESSABLE_ENTITY');
    expect(r.payment_source.card.last_digits).toBe('1111');
  });
});
