import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PaymentsConfigError } from '../src/config.js';
import { PayPalError } from '../src/errors.js';
import { FakePayPalServer } from '../src/fake/server.js';
import { OrdersClient, extractAuthorizationId, type OrdersAuth } from '../src/orders.js';
import { TokenManager } from '../src/oauth.js';
import { Transport, type FetchLike, type TransportResult } from '../src/transport.js';

interface Seen {
  method: string;
  url: string;
  body: string | undefined;
  headers: Record<string, string>;
}

let server: FakePayPalServer;
let seen: Seen[];
let client: OrdersClient;

const noSleep = async (): Promise<void> => undefined;

beforeEach(async () => {
  server = new FakePayPalServer({ timers: { sleep: noSleep } });
  await server.start();
  seen = [];
  const recording: FetchLike = async (url, init) => {
    seen.push({ method: init.method, url, body: init.body, headers: init.headers });
    return fetch(url, init);
  };
  const transport = new Transport({ fetch: recording, sleep: noSleep });
  const auth = new TokenManager({
    transport,
    baseUrl: server.url,
    clientId: 'fake-client',
    clientSecret: 'fake-secret-value',
  });
  client = new OrdersClient({ auth, fake: true });
});

afterEach(async () => {
  await server.stop();
});

function lastBody(path: string): Record<string, unknown> {
  const hit = [...seen].reverse().find((s) => s.url.endsWith(path));
  if (hit?.body === undefined) throw new Error(`no request body seen for ${path}`);
  return JSON.parse(hit.body) as Record<string, unknown>;
}

function stubAuth(status: number, body: unknown): OrdersAuth {
  return {
    send: async (): Promise<TransportResult> => ({
      status,
      headers: {},
      text: typeof body === 'string' ? body : JSON.stringify(body),
      attempts: 1,
    }),
  };
}

async function failure(p: Promise<unknown>): Promise<PayPalError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof PayPalError) return e;
    throw e;
  }
  throw new Error('expected the call to fail');
}

describe('T-PAY-015 createOrder', () => {
  it('posts an AUTHORIZE order with one purchase unit built from cents', async () => {
    const created = await client.createOrder({
      holdId: 'hold-1',
      ceilingCents: 12550,
      description: 'Gavel hold',
      requestId: 'req-create-1',
    });
    expect(created.orderId).not.toBe('');
    expect(created.approveUrl).toMatch(/^http:\/\/127\.0\.0\.1\//);

    const body = lastBody('/v2/checkout/orders');
    expect(body['intent']).toBe('AUTHORIZE');
    const units = body['purchase_units'] as Array<Record<string, unknown>>;
    expect(units).toHaveLength(1);
    expect(units[0]?.['custom_id']).toBe('hold-1');
    expect(units[0]?.['reference_id']).toBe('hold-1');
    expect(units[0]?.['amount']).toEqual({ currency_code: 'USD', value: '125.50' });

    const post = seen.find((s) => s.url.endsWith('/v2/checkout/orders'));
    expect(post?.headers['PayPal-Request-Id']).toBe('req-create-1');
  });

  it('is idempotent for the same request id', async () => {
    const i = { holdId: 'hold-2', ceilingCents: 5000, description: 'd', requestId: 'req-same' };
    const a = await client.createOrder(i);
    const b = await client.createOrder(i);
    expect(b.orderId).toBe(a.orderId);
  });

  it('truncates the description to 127 characters', async () => {
    await client.createOrder({
      holdId: 'hold-3',
      ceilingCents: 100,
      description: 'x'.repeat(300),
      requestId: 'req-long',
    });
    const units = lastBody('/v2/checkout/orders')['purchase_units'] as Array<
      Record<string, unknown>
    >;
    expect(String(units[0]?.['description'])).toHaveLength(127);
  });

  it('rejects an approve link on a foreign host and returns no order', async () => {
    const bad = stubAuth(201, {
      id: 'ORDER-1',
      status: 'CREATED',
      links: [{ rel: 'approve', href: 'https://www.paypal.com/checkoutnow?token=ORDER-1' }],
    });
    const c = new OrdersClient({ auth: bad, fake: false });
    await expect(
      c.createOrder({ holdId: 'h', ceilingCents: 100, description: 'd', requestId: 'r' }),
    ).rejects.toBeInstanceOf(PaymentsConfigError);
  });

  it('accepts the sandbox checkout host, and loopback only in fake mode', async () => {
    const order = (href: string): OrdersAuth =>
      stubAuth(201, { id: 'O-1', links: [{ rel: 'approve', href }] });
    const input = { holdId: 'h', ceilingCents: 100, description: 'd', requestId: 'r' };
    const sandbox = new OrdersClient({
      auth: order('https://www.sandbox.paypal.com/checkoutnow?token=O-1'),
      fake: false,
    });
    await expect(sandbox.createOrder(input)).resolves.toMatchObject({ orderId: 'O-1' });
    const loopbackReal = new OrdersClient({
      auth: order('http://127.0.0.1/checkoutnow'),
      fake: false,
    });
    await expect(loopbackReal.createOrder(input)).rejects.toBeInstanceOf(PaymentsConfigError);
  });

  it('classifies a refused request and an unreadable answer', async () => {
    const input = { holdId: 'h', ceilingCents: 100, description: 'd', requestId: 'r' };
    const refused = new OrdersClient({
      auth: stubAuth(400, { name: 'INVALID_REQUEST', message: 'bad' }),
      fake: true,
    });
    const e1 = await failure(refused.createOrder(input));
    expect(e1.kind).toBe('invalid_request');
    expect(e1.outcome).toBe('definite');

    const garbled = new OrdersClient({ auth: stubAuth(201, '<html>'), fake: true });
    const e2 = await failure(garbled.createOrder(input));
    expect(e2.outcome).toBe('unknown');
  });
});

describe('T-PAY-016 authorizeOrder', () => {
  async function newOrder(holdId: string, cents = 8000): Promise<string> {
    const o = await client.createOrder({
      holdId,
      ceilingCents: cents,
      description: 'd',
      requestId: `req-${holdId}`,
    });
    return o.orderId;
  }

  it('returns the authorization id of an approved order', async () => {
    const orderId = await newOrder('hold-a');
    server.core.approveOrder(orderId);
    const a = await client.authorizeOrder(orderId, 'req-auth-a');
    expect(a.authId).not.toBe('');
    expect(a.amountCents).toBe(8000);

    const order = await client.getOrder(orderId);
    expect(order).toEqual({ orderId, status: 'COMPLETED', authId: a.authId });
  });

  it('reports an unapproved order as order_not_approved (definite)', async () => {
    const orderId = await newOrder('hold-b');
    const err = await failure(client.authorizeOrder(orderId, 'req-auth-b'));
    expect(err.name).toBe('order_not_approved');
    expect(err.kind).toBe('rejected');
    expect(err.outcome).toBe('definite');
    expect(err.status).toBe(422);
    expect(err.issue).toBe('ORDER_NOT_APPROVED');
  });

  it('getOrder shows an order without authorization id until it is authorized', async () => {
    const orderId = await newOrder('hold-c');
    expect(await client.getOrder(orderId)).toEqual({ orderId, status: 'CREATED' });
    server.core.approveOrder(orderId);
    expect(await client.getOrder(orderId)).toEqual({ orderId, status: 'APPROVED' });
  });

  it('maps an unknown order to not_found', async () => {
    const err = await failure(client.getOrder('NO-SUCH-ORDER'));
    expect(err.kind).toBe('not_found');
    expect(err.outcome).toBe('definite');
  });

  it('treats a 2xx answer without an authorization id as an unknown outcome', async () => {
    const c = new OrdersClient({
      auth: stubAuth(201, { id: 'O-1', status: 'COMPLETED' }),
      fake: true,
    });
    const err = await failure(c.authorizeOrder('O-1', 'r'));
    expect(err.outcome).toBe('unknown');
  });
});

describe('extractAuthorizationId', () => {
  it('reads purchase_units[0].payments.authorizations[0].id', () => {
    const order = {
      purchase_units: [{ payments: { authorizations: [{ id: 'AUTH-1' }, { id: 'AUTH-2' }] } }],
    };
    expect(extractAuthorizationId(order)).toBe('AUTH-1');
  });

  it('is undefined for every other shape', () => {
    expect(extractAuthorizationId(undefined)).toBeUndefined();
    expect(extractAuthorizationId({})).toBeUndefined();
    expect(extractAuthorizationId({ purchase_units: [] })).toBeUndefined();
    expect(extractAuthorizationId({ purchase_units: [{ payments: {} }] })).toBeUndefined();
    expect(
      extractAuthorizationId({ purchase_units: [{ payments: { authorizations: [{ id: '' }] } }] }),
    ).toBeUndefined();
  });
});
