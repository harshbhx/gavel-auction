import { describe, expect, it } from 'vitest';
import {
  availableFunds,
  concludeG1Observation,
  looksSignedOut,
  mentionsPending,
  moneyCents,
  observeG1,
  requestInit,
  summarizeView,
  type ApiReply,
  type BuyerView,
  type ObserveDeps,
  type Reading,
} from '../../gates/g1-observe.js';

const view = (availableCents: number | null): BuyerView => ({
  readable: availableCents !== null,
  availableCents,
  activityMentionsPending: false,
  reason: availableCents === null ? 'not read' : '',
});
const reading = (step: Reading['step'], cents: number | null): Reading => ({
  step,
  buyer: view(cents),
  api: { authorizationHttp: null, authorizationStatus: '', orderHttp: null, orderStatus: '' },
});

describe('G1 observation: reading money from page text', () => {
  it('parses dollar amounts with separators and signs', () => {
    expect(moneyCents('Balance $1,234.56 USD and USD 12.50, was -$3.07 (US$ 7.00)')).toEqual([
      123456, 1250, -307, 700,
    ]);
    expect(moneyCents('no money here, 12 items')).toEqual([]);
  });

  it('takes available funds from the balance line or the line after it', () => {
    expect(availableFunds('Hello\nPayPal balance\n$9,000.00 USD\nOther $1.00')).toBe(900000);
    expect(availableFunds('Available: $25.10 USD')).toBe(2510);
    expect(availableFunds('Welcome back\nRecent activity')).toBeNull();
  });

  it('flags pending mentions and signed-out pages without keeping text', () => {
    expect(mentionsPending('Payment authorization pending')).toBe(true);
    expect(mentionsPending('Nothing to see')).toBe(false);
    expect(looksSignedOut('https://www.sandbox.paypal.com/signin?x=1', '')).toBe(true);
    expect(looksSignedOut('https://www.sandbox.paypal.com/myaccount/summary', 'Balance')).toBe(
      false,
    );
    const v = summarizeView('PayPal balance $5.00', 'pending', false);
    expect(v).toEqual({
      readable: true,
      availableCents: 500,
      activityMentionsPending: true,
      reason: '',
    });
    expect(summarizeView('', '', true).readable).toBe(false);
  });
});

describe('G1 observation: when "observed" may be written', () => {
  it('is observed only when the hold and its partial release both show', () => {
    const c = concludeG1Observation([
      reading('before-authorize', 100000),
      reading('after-authorize', 50000),
      reading('after-capture', 65000),
    ]);
    expect(c.status).toBe('observed');
    expect(c.sentence).toContain('1000.00');
    expect(c.sentence).toContain('500.00');
    expect(c.sentence).toContain('650.00');
    expect(c.sentence).toContain('150.00 remainder was released');
  });

  it('stays inferred when the buyer view shows no hold at authorize', () => {
    const c = concludeG1Observation([
      reading('before-authorize', 100000),
      reading('after-authorize', 100000),
      reading('after-capture', 65000),
    ]);
    expect(c.status).toBe('inferred');
    expect(c.sentence).toContain('does not show the hold');
  });

  it('stays inferred when the capture took a different amount than expected', () => {
    const c = concludeG1Observation([
      reading('before-authorize', 100000),
      reading('after-authorize', 50000),
      reading('after-capture', 50000),
    ]);
    expect(c.status).toBe('inferred');
  });

  it('stays inferred when a page cannot be read or a reading is missing', () => {
    expect(
      concludeG1Observation([
        reading('before-authorize', 100000),
        reading('after-authorize', null),
        reading('after-capture', 65000),
      ]).status,
    ).toBe('inferred');
    expect(concludeG1Observation([reading('before-authorize', 1)]).sentence).toMatch(
      /did not reach/,
    );
  });
});

function fakeDeps(
  views: Array<number | null>,
  capStatus = 201,
): { deps: ObserveDeps; calls: string[] } {
  const calls: string[] = [];
  let i = 0;
  const reply = (status: number, json: unknown): ApiReply => ({ status, json });
  const deps: ObserveDeps = {
    currency: 'USD',
    runTag: 't1',
    sleep: () => Promise.resolve(),
    request: (method, path) => {
      calls.push(`${method} ${path}`);
      if (path === '/v2/checkout/orders' && method === 'POST') {
        return Promise.resolve(
          reply(201, {
            id: 'ORD',
            status: 'CREATED',
            links: [
              { rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=ORD' },
            ],
          }),
        );
      }
      if (path.endsWith('/authorize')) {
        return Promise.resolve(
          reply(201, { purchase_units: [{ payments: { authorizations: [{ id: 'AUTH' }] } }] }),
        );
      }
      if (path.endsWith('/capture'))
        return Promise.resolve(reply(capStatus, { status: 'COMPLETED' }));
      return Promise.resolve(
        reply(200, { status: path.includes('payments') ? 'CAPTURED' : 'COMPLETED' }),
      );
    },
    approve: async (url, during) => {
      calls.push(`approve ${new URL(url).hostname}`);
      await during(() => {
        const v = views[i] ?? null;
        i += 1;
        return Promise.resolve(view(v));
      });
    },
  };
  return { deps, calls };
}

describe('G1 observation: the run', () => {
  it('reads before authorize, after authorize and after capture, in that order', async () => {
    const { deps, calls } = fakeDeps([100000, 50000, 65000]);
    const r = await observeG1(deps);
    expect(r.error).toBe('');
    expect(r.readings.map((x) => x.step)).toEqual([
      'before-authorize',
      'after-authorize',
      'after-capture',
    ]);
    expect(r.conclusion.status).toBe('observed');
    expect(r.captureHttp).toBe(201);
    const order = calls.filter((c) => /authorize|capture|approve/.test(c) && !c.startsWith('GET'));
    expect(order).toEqual([
      'approve www.sandbox.paypal.com',
      'POST /v2/checkout/orders/ORD/authorize',
      'POST /v2/payments/authorizations/AUTH/capture',
    ]);
    expect(r.readings[2]?.api.authorizationStatus).toBe('CAPTURED');
  });

  it('records the error and stays inferred when the capture is refused', async () => {
    const { deps } = fakeDeps([100000, 50000, 65000], 422);
    const r = await observeG1(deps);
    expect(r.error).toMatch(/capture answered HTTP 422/);
    expect(r.conclusion.status).toBe('inferred');
    expect(r.captureHttp).toBe(422);
  });

  it('writes no ids or emails into the result', async () => {
    const { deps } = fakeDeps([100000, 50000, 65000]);
    const r = await observeG1(deps);
    const text = JSON.stringify(r);
    expect(text).not.toContain('ORD');
    expect(text).not.toContain('AUTH"');
    expect(text).not.toContain('@');
  });
});

describe('G1 observation: API request options', () => {
  it('sends {} with a JSON content type on a bodyless POST (PayPal answers 415 otherwise)', () => {
    const init = requestInit('POST', 't', undefined, { 'PayPal-Request-Id': 'x' });
    expect(init.body).toBe('{}');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.headers['PayPal-Request-Id']).toBe('x');
  });

  it('sends the payload as JSON and sends nothing on a GET', () => {
    expect(requestInit('POST', 't', { a: 1 }).body).toBe('{"a":1}');
    const get = requestInit('GET', 't');
    expect(get.body).toBeUndefined();
    expect(get.headers['Content-Type']).toBeUndefined();
  });
});
