import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakePayPalServer } from '../../src/fake/server.js';
import { WebhookEmitter, buildVerifyRequest } from '../../src/fake/webhooks.js';

let server: FakePayPalServer;

beforeEach(async () => {
  server = new FakePayPalServer({ timers: { sleep: async () => undefined } });
  await server.start();
});

afterEach(async () => {
  await server.stop();
});

interface Reply {
  status: number;
  headers: Headers;
  text: string;
  json: Record<string, unknown>;
}

async function call(
  method: string,
  path: string,
  opts: { token?: string | null; body?: unknown; requestId?: string; raw?: string } = {},
): Promise<Reply> {
  const headers: Record<string, string> = {};
  if (opts.token !== null && opts.token !== undefined)
    headers['Authorization'] = `Bearer ${opts.token}`;
  if (opts.requestId !== undefined) headers['PayPal-Request-Id'] = opts.requestId;
  let body: string | undefined;
  if (opts.raw !== undefined) body = opts.raw;
  else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${server.url}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body } : {}),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = {};
  }
  return { status: res.status, headers: res.headers, text, json };
}

async function token(): Promise<string> {
  const res = await call('POST', '/v1/oauth2/token', { raw: 'grant_type=client_credentials' });
  return res.json['access_token'] as string;
}

const ORDER = {
  intent: 'AUTHORIZE',
  purchase_units: [
    {
      reference_id: 'hold-1',
      custom_id: 'hold-1',
      description: 'Gavel hold',
      amount: { currency_code: 'USD', value: '50.00' },
    },
  ],
};

/** Walks one hold from order to authorization and returns the ids. */
async function authorized(tok: string): Promise<{ orderId: string; authId: string }> {
  const created = await call('POST', '/v2/checkout/orders', {
    token: tok,
    body: ORDER,
    requestId: 'rq-order',
  });
  const orderId = created.json['id'] as string;
  server.core.approveOrder(orderId);
  const auth = await call('POST', `/v2/checkout/orders/${orderId}/authorize`, {
    token: tok,
    body: {},
    requestId: 'rq-auth',
  });
  const units = auth.json['purchase_units'] as Array<{
    payments: { authorizations: Array<{ id: string }> };
  }>;
  return { orderId, authId: units[0]?.payments.authorizations[0]?.id ?? '' };
}

describe('FakePayPalServer routes (T-PAY-074)', () => {
  it('binds an ephemeral loopback port and stops cleanly', async () => {
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    await server.stop();
    expect(() => server.url).toThrow();
    await server.stop();
    await server.start();
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('issues a bearer token with the PayPal fields', async () => {
    const res = await call('POST', '/v1/oauth2/token', { raw: 'grant_type=client_credentials' });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      token_type: 'Bearer',
      expires_in: 32400,
      access_token: 'fake-token-1',
    });
    expect(res.headers.get('paypal-debug-id')).toBe('fake-debug-1');
  });

  it('checks Basic credentials when the server has them configured', async () => {
    await server.stop();
    server = new FakePayPalServer({ clientId: 'id', clientSecret: 'secret' });
    await server.start();
    const bad = await fetch(`${server.url}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: 'Basic nope' },
      body: 'grant_type=client_credentials',
    });
    expect(bad.status).toBe(401);
    const good = await fetch(`${server.url}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from('id:secret').toString('base64')}` },
      body: 'grant_type=client_credentials',
    });
    expect(good.status).toBe(200);
  });

  it('rejects business calls without a valid token', async () => {
    const none = await call('POST', '/v2/checkout/orders', { body: ORDER });
    expect(none.status).toBe(401);
    const wrong = await call('POST', '/v2/checkout/orders', { token: 'nope', body: ORDER });
    expect(wrong.status).toBe(401);
    expect(wrong.json['name']).toBe('AUTHENTICATION_FAILURE');
  });

  it('expires tokens on the fake clock', async () => {
    const tok = await token();
    server.core.clock.advance(32_400_000);
    const res = await call('GET', '/v2/checkout/orders/ORDER-1', { token: tok });
    expect(res.status).toBe(401);
  });

  it('createOrder: PayPal shape, AUTHORIZE intent, approve link, deterministic id', async () => {
    const tok = await token();
    const res = await call('POST', '/v2/checkout/orders', {
      token: tok,
      body: ORDER,
      requestId: 'rq-1',
    });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({
      id: 'ORDER-1',
      status: 'CREATED',
      intent: 'AUTHORIZE',
      purchase_units: [
        {
          custom_id: 'hold-1',
          reference_id: 'hold-1',
          amount: { currency_code: 'USD', value: '50.00' },
        },
      ],
    });
    const links = res.json['links'] as Array<{ rel: string; href: string }>;
    const approve = links.find((l) => l.rel === 'approve');
    expect(approve?.href).toContain('token=ORDER-1');
    expect(res.headers.get('paypal-debug-id')).toMatch(/^fake-debug-\d+$/);
  });

  it('createOrder: bad intent or amount gives 400', async () => {
    const tok = await token();
    const intent = await call('POST', '/v2/checkout/orders', {
      token: tok,
      body: { ...ORDER, intent: 'CAPTURE' },
    });
    expect(intent.status).toBe(400);
    const amount = await call('POST', '/v2/checkout/orders', {
      token: tok,
      body: {
        intent: 'AUTHORIZE',
        purchase_units: [{ custom_id: 'h', amount: { currency_code: 'USD', value: '5' } }],
      },
    });
    expect(amount.status).toBe(400);
    const junk = await call('POST', '/v2/checkout/orders', { token: tok, raw: '{not json' });
    expect(junk.status).toBe(400);
  });

  it('authorize: a POST without a body or JSON content type is 415', async () => {
    const tok = await token();
    const created = await call('POST', '/v2/checkout/orders', { token: tok, body: ORDER });
    const id = created.json['id'] as string;
    server.core.approveOrder(id);
    const path = `/v2/checkout/orders/${id}/authorize`;
    const bare = await call('POST', path, { token: tok });
    expect(bare.status).toBe(415);
    expect(JSON.stringify(bare.json)).toContain('UNSUPPORTED_MEDIA_TYPE');
    const noType = await call('POST', path, { token: tok, raw: '{}' });
    expect(noType.status).toBe(415);
    const ok = await call('POST', path, { token: tok, body: {} });
    expect(ok.status).toBe(201);
  });

  it('authorize: unapproved gives 422 ORDER_NOT_APPROVED, approved gives the authorization', async () => {
    const tok = await token();
    const created = await call('POST', '/v2/checkout/orders', { token: tok, body: ORDER });
    const id = created.json['id'] as string;
    const early = await call('POST', `/v2/checkout/orders/${id}/authorize`, {
      token: tok,
      body: {},
    });
    expect(early.status).toBe(422);
    expect(JSON.stringify(early.json)).toContain('ORDER_NOT_APPROVED');
    server.core.approveOrder(id);
    const ok = await call('POST', `/v2/checkout/orders/${id}/authorize`, { token: tok, body: {} });
    expect(ok.status).toBe(201);
    expect(ok.json).toMatchObject({
      id,
      status: 'COMPLETED',
      purchase_units: [
        {
          payments: {
            authorizations: [{ id: 'AUTH-1', status: 'CREATED', amount: { value: '50.00' } }],
          },
        },
      ],
    });
  });

  it('getOrder: carries the authorization and captures once they exist', async () => {
    const tok = await token();
    const { orderId, authId } = await authorized(tok);
    await call('POST', `/v2/payments/authorizations/${authId}/capture`, {
      token: tok,
      body: {
        amount: { currency_code: 'USD', value: '35.00' },
        final_capture: true,
        invoice_id: 'inv-1',
      },
    });
    const res = await call('GET', `/v2/checkout/orders/${orderId}`, { token: tok });
    expect(res.status).toBe(200);
    const unit = (res.json['purchase_units'] as Array<Record<string, unknown>>)[0];
    const payments = unit?.['payments'] as {
      authorizations: Array<{ id: string; status: string }>;
      captures: Array<{ id: string; final_capture: boolean }>;
    };
    expect(payments.authorizations[0]).toMatchObject({ id: 'AUTH-1', status: 'CAPTURED' });
    expect(payments.captures[0]).toMatchObject({ id: 'CAP-1', final_capture: true });
  });

  it('getOrder: unknown id gives 404 RESOURCE_NOT_FOUND', async () => {
    const tok = await token();
    const res = await call('GET', '/v2/checkout/orders/ORDER-99', { token: tok });
    expect(res.status).toBe(404);
    expect(res.json['name']).toBe('RESOURCE_NOT_FOUND');
  });

  it('getAuthorization, capture, void and reauthorize', async () => {
    const tok = await token();
    const { authId } = await authorized(tok);

    const got = await call('GET', `/v2/payments/authorizations/${authId}`, { token: tok });
    expect(got.json).toMatchObject({ id: authId, status: 'CREATED', amount: { value: '50.00' } });

    const cap = await call('POST', `/v2/payments/authorizations/${authId}/capture`, {
      token: tok,
      requestId: 'rq-cap',
      body: {
        amount: { currency_code: 'USD', value: '20.00' },
        final_capture: false,
        invoice_id: 'inv-9',
      },
    });
    expect(cap.status).toBe(201);
    expect(cap.json).toMatchObject({
      id: 'CAP-1',
      status: 'COMPLETED',
      amount: { currency_code: 'USD', value: '20.00' },
      final_capture: false,
      invoice_id: 'inv-9',
    });

    const replay = await call('POST', `/v2/payments/authorizations/${authId}/capture`, {
      token: tok,
      requestId: 'rq-cap',
      body: { amount: { currency_code: 'USD', value: '20.00' }, final_capture: false },
    });
    expect(replay.json['id']).toBe('CAP-1');
    const conflict = await call('POST', `/v2/payments/authorizations/${authId}/capture`, {
      token: tok,
      requestId: 'rq-cap',
      body: { amount: { currency_code: 'USD', value: '21.00' }, final_capture: false },
    });
    expect(conflict.status).toBe(422);
    expect(JSON.stringify(conflict.json)).toContain('DUPLICATE_REQUEST_ID_DIFFERENT_PARAMS');

    const rest = await call('POST', `/v2/payments/authorizations/${authId}/capture`, {
      token: tok,
      body: { final_capture: true },
    });
    expect(rest.json['amount']).toMatchObject({ value: '30.00' });

    const voided = await call('POST', `/v2/payments/authorizations/${authId}/void`, { token: tok });
    expect(voided.status).toBe(422);
    expect(voided.json['name']).toBe('UNPROCESSABLE_ENTITY');
  });

  it('void answers 204 with no body and a second void is 422', async () => {
    const tok = await token();
    const { authId } = await authorized(tok);
    const first = await call('POST', `/v2/payments/authorizations/${authId}/void`, { token: tok });
    expect(first.status).toBe(204);
    expect(first.text).toBe('');
    const second = await call('POST', `/v2/payments/authorizations/${authId}/void`, { token: tok });
    expect(second.status).toBe(422);
    expect(JSON.stringify(second.json)).toContain('AUTHORIZATION_ALREADY_VOIDED');
  });

  it('reauthorize follows the honor period of the core', async () => {
    const tok = await token();
    const { authId } = await authorized(tok);
    const early = await call('POST', `/v2/payments/authorizations/${authId}/reauthorize`, {
      token: tok,
      body: { amount: { currency_code: 'USD', value: '50.00' } },
    });
    expect(early.status).toBe(422);
    server.core.clock.advance(4 * 86_400_000);
    const tok2 = await token();
    const ok = await call('POST', `/v2/payments/authorizations/${authId}/reauthorize`, {
      token: tok2,
      body: { amount: { currency_code: 'USD', value: '50.00' } },
    });
    expect(ok.status).toBe(201);
    expect(ok.json).toMatchObject({ id: authId, amount: { value: '50.00' } });
  });

  it('verify-webhook-signature answers SUCCESS for a signed event and FAILURE for a changed one', async () => {
    const tok = await token();
    const emitter = new WebhookEmitter({ webhookId: 'WH-FAKE', nowMs: () => 0 });
    const { authId } = await authorized(tok);
    const events = server.core.deliver('fifo');
    expect(events.length).toBeGreaterThan(0);
    const first = events[0];
    if (first === undefined) throw new Error('no event');
    const signed = emitter.sign(first);
    const good = await call('POST', '/v1/notifications/verify-webhook-signature', {
      token: tok,
      raw: buildVerifyRequest(signed, 'WH-FAKE'),
    });
    expect(good.json).toEqual({ verification_status: 'SUCCESS' });
    const bad = await call('POST', '/v1/notifications/verify-webhook-signature', {
      token: tok,
      raw: buildVerifyRequest(signed, 'WH-OTHER'),
    });
    expect(bad.json).toEqual({ verification_status: 'FAILURE' });
    expect(authId).toBe('AUTH-1');
  });

  it('unknown routes give 404 and still carry a debug id', async () => {
    const tok = await token();
    const res = await call('GET', '/v2/nothing', { token: tok });
    expect(res.status).toBe(404);
    expect(res.headers.get('paypal-debug-id')).not.toBeNull();
  });

  it('reset starts over: ids restart, tokens and faults are gone', async () => {
    const tok = await token();
    await authorized(tok);
    server.faults.add({ kind: 'http_500', op: 'order' });
    server.reset();
    expect(server.faults.pending()).toBe(0);
    const stale = await call('POST', '/v2/checkout/orders', { token: tok, body: ORDER });
    expect(stale.status).toBe(401);
    const tok2 = await token();
    expect(tok2).toBe('fake-token-1');
    const res = await call('POST', '/v2/checkout/orders', { token: tok2, body: ORDER });
    expect(res.json['id']).toBe('ORDER-1');
    expect(res.headers.get('paypal-debug-id')).toBe('fake-debug-3');
  });

  it('ids and debug ids are the same on two identical runs', async () => {
    async function run(): Promise<string[]> {
      server.reset();
      const tok = await token();
      const { orderId, authId } = await authorized(tok);
      const cap = await call('POST', `/v2/payments/authorizations/${authId}/capture`, {
        token: tok,
        body: { amount: { currency_code: 'USD', value: '10.00' }, final_capture: true },
      });
      return [orderId, authId, cap.json['id'] as string, cap.headers.get('paypal-debug-id') ?? ''];
    }
    expect(await run()).toEqual(await run());
  });
});

describe('FakePayPalServer faults', () => {
  it('http_500 answers 500 INTERNAL_SERVICE_ERROR and does not apply the call', async () => {
    const tok = await token();
    server.faults.add({ kind: 'http_500', op: 'order' });
    const res = await call('POST', '/v2/checkout/orders', { token: tok, body: ORDER });
    expect(res.status).toBe(500);
    expect(res.json['name']).toBe('INTERNAL_SERVICE_ERROR');
    const again = await call('POST', '/v2/checkout/orders', { token: tok, body: ORDER });
    expect(again.json['id']).toBe('ORDER-1');
  });

  it('http_429 carries Retry-After', async () => {
    const tok = await token();
    server.faults.add({ kind: 'http_429', op: '*', retryAfterSec: 7 });
    const res = await call('GET', '/v2/checkout/orders/ORDER-1', { token: tok });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('7');
  });

  it('http_401_once revokes the presented token; a new token works', async () => {
    const tok = await token();
    const { authId } = await authorized(tok);
    server.faults.add({ kind: 'http_401_once', op: 'capture' });
    const body = { amount: { currency_code: 'USD', value: '10.00' }, final_capture: true };
    const first = await call('POST', `/v2/payments/authorizations/${authId}/capture`, {
      token: tok,
      body,
    });
    expect(first.status).toBe(401);
    const stale = await call('POST', `/v2/payments/authorizations/${authId}/capture`, {
      token: tok,
      body,
    });
    expect(stale.status).toBe(401);
    const tok2 = await token();
    const ok = await call('POST', `/v2/payments/authorizations/${authId}/capture`, {
      token: tok2,
      body,
    });
    expect(ok.status).toBe(201);
  });

  it('connection_reset and timeout kinds drop the connection', async () => {
    const tok = await token();
    server.faults.add({ kind: 'connection_reset', op: 'order' });
    await expect(
      call('POST', '/v2/checkout/orders', { token: tok, body: ORDER }),
    ).rejects.toThrow();
    server.faults.add({ kind: 'timeout_before', op: 'order' });
    await expect(
      call('POST', '/v2/checkout/orders', { token: tok, body: ORDER }),
    ).rejects.toThrow();
    expect(server.core.authCount()).toBe(0);
  });

  it('timeout_after_success applies the call and drops the response', async () => {
    const tok = await token();
    server.faults.add({ kind: 'timeout_after_success', op: 'order' });
    await expect(
      call('POST', '/v2/checkout/orders', { token: tok, body: ORDER }),
    ).rejects.toThrow();
    const res = await call('GET', '/v2/checkout/orders/ORDER-1', { token: tok });
    expect(res.status).toBe(200);
  });

  it('malformed_body returns truncated JSON for an applied call', async () => {
    const tok = await token();
    server.faults.add({ kind: 'malformed_body', op: 'order' });
    const res = await call('POST', '/v2/checkout/orders', { token: tok, body: ORDER });
    expect(res.status).toBe(200);
    expect(() => JSON.parse(res.text)).toThrow();
    const got = await call('GET', '/v2/checkout/orders/ORDER-1', { token: tok });
    expect(got.status).toBe(200);
  });

  it('capture_declined answers 422 INSTRUMENT_DECLINED', async () => {
    const tok = await token();
    const { authId } = await authorized(tok);
    server.faults.add({ kind: 'capture_declined', op: 'capture' });
    const res = await call('POST', `/v2/payments/authorizations/${authId}/capture`, {
      token: tok,
      body: { amount: { currency_code: 'USD', value: '10.00' }, final_capture: true },
    });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.json)).toContain('INSTRUMENT_DECLINED');
  });

  it('forget_idempotency clears the replay table after the call', async () => {
    const tok = await token();
    const { authId } = await authorized(tok);
    server.faults.add({ kind: 'forget_idempotency', op: 'capture' });
    const body = { amount: { currency_code: 'USD', value: '10.00' }, final_capture: false };
    const path = `/v2/payments/authorizations/${authId}/capture`;
    const first = await call('POST', path, { token: tok, body, requestId: 'rq' });
    const second = await call('POST', path, { token: tok, body, requestId: 'rq' });
    expect(first.json['id']).toBe('CAP-1');
    expect(second.json['id']).toBe('CAP-2');
  });
});
