import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PayPalError } from '../../src/errors.js';
import { FakePayPalServer } from '../../src/fake/server.js';
import { OrdersClient } from '../../src/orders.js';
import { TokenManager } from '../../src/oauth.js';
import { PaymentsApiClient } from '../../src/paymentsApi.js';
import { Transport, type FetchLike } from '../../src/transport.js';
import { ENDPOINTS, diffShape, type Endpoint, type ObjNode } from './schema.js';

// T-QA-028: the fake PayPal and the real client agree on the shape of every endpoint.
// The real client code runs against the fake server; each exchange is recorded and checked
// against the shape table in both directions (a field the shape needs and the fake lacks, a
// field the fake sends and the shape does not know, the same for the client's request bodies).

interface Exchange {
  method: string;
  path: string;
  status: number;
  requestBody: string | undefined;
  responseText: string;
}

const noSleep = async (): Promise<void> => undefined;

let server: FakePayPalServer;
const seen: Exchange[] = [];

async function failure(p: Promise<unknown>): Promise<PayPalError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof PayPalError) return e;
    throw e;
  }
  throw new Error('expected the call to fail');
}

beforeAll(async () => {
  server = new FakePayPalServer({ timers: { sleep: noSleep }, core: { honorMs: 0 } });
  await server.start();
  const recording: FetchLike = async (url, init) => {
    const res = await fetch(url, init);
    const responseText = await res.clone().text();
    seen.push({
      method: init.method,
      path: new URL(url).pathname,
      status: res.status,
      requestBody: init.body,
      responseText,
    });
    return res;
  };
  const transport = new Transport({ fetch: recording, sleep: noSleep });
  const auth = new TokenManager({
    transport,
    baseUrl: server.url,
    clientId: 'fake-client',
    clientSecret: 'fake-secret-value',
  });
  const orders = new OrdersClient({ auth, fake: true });
  const payments = new PaymentsApiClient({ auth });

  const order = await orders.createOrder({
    holdId: 'hold-contract-1',
    ceilingCents: 30000,
    description: 'contract',
    requestId: 'req-create-1',
  });
  await orders.getOrder(order.orderId);
  server.core.approveOrder(order.orderId);
  const authz = await orders.authorizeOrder(order.orderId, 'req-auth-1');
  await payments.getAuthorization(authz.authId);
  await payments.capture(authz.authId, {
    amountCents: 10000,
    finalCapture: false,
    invoiceId: 'inv-contract-1',
    requestId: 'req-capture-1',
  });
  await orders.getOrder(order.orderId);
  server.core.clock.advance(1);
  await payments.reauthorize(authz.authId, { amountCents: 20000, requestId: 'req-reauth-1' });

  const second = await orders.createOrder({
    holdId: 'hold-contract-2',
    ceilingCents: 15000,
    description: 'contract',
    requestId: 'req-create-2',
  });
  server.core.approveOrder(second.orderId);
  const secondAuth = await orders.authorizeOrder(second.orderId, 'req-auth-2');
  await payments.voidAuthorization(secondAuth.authId, 'req-void-1');

  await failure(payments.getAuthorization('A-UNKNOWN'));
  const third = await orders.createOrder({
    holdId: 'hold-contract-3',
    ceilingCents: 15000,
    description: 'contract',
    requestId: 'req-create-3',
  });
  await failure(orders.authorizeOrder(third.orderId, 'req-auth-3'));

  // The verify route is called by the webhook verifier, which needs a signed event; an empty
  // object is enough to see the shape of the answer.
  const token = seen.find((s) => s.path === '/v1/oauth2/token');
  expect(token).toBeDefined();
  const bearer = (JSON.parse(token?.responseText ?? '{}') as { access_token?: string })
    .access_token;
  const res = await fetch(`${server.url}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${bearer ?? ''}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  seen.push({
    method: 'POST',
    path: '/v1/notifications/verify-webhook-signature',
    status: res.status,
    requestBody: '{}',
    responseText: await res.text(),
  });
});

afterAll(async () => {
  await server.stop();
});

function exchangeOf(e: Endpoint): Exchange {
  const hits = seen.filter((s) => s.method === e.method && e.path.test(s.path));
  const hit = hits[e.call ?? 0];
  if (hit === undefined) throw new Error(`no recorded exchange for ${e.id}`);
  return hit;
}

describe('T-QA-028 fake PayPal against the real client shapes', () => {
  it('lists 12 endpoints', () => {
    expect(ENDPOINTS).toHaveLength(12);
  });

  describe.each(ENDPOINTS.map((e) => [e.id, e] as const))('%s', (_id, e) => {
    it('answers with the shape the client reads, no field missing or extra', () => {
      const x = exchangeOf(e);
      expect(x.status).toBe(e.status);
      if (e.response === 'empty') {
        expect(x.responseText).toBe('');
        return;
      }
      expect(diffShape(e.response, JSON.parse(x.responseText))).toEqual([]);
    });

    it('accepts the request body the real client sends', () => {
      const x = exchangeOf(e);
      if (e.request === undefined) return;
      expect(x.requestBody).toBeDefined();
      expect(diffShape(e.request, JSON.parse(x.requestBody ?? '{}'))).toEqual([]);
    });
  });

  describe('the check itself detects drift', () => {
    const jsonEndpoints = ENDPOINTS.filter((e) => e.response !== 'empty');

    it.each(jsonEndpoints.map((e) => [e.id, e] as const))(
      '%s: removing any top level field of the fake answer fails',
      (_id, e) => {
        const shape = e.response as ObjNode;
        const body = JSON.parse(exchangeOf(e).responseText) as Record<string, unknown>;
        for (const [key, node] of Object.entries(shape.fields)) {
          if (node.opt === true) continue;
          const { [key]: removed, ...rest } = body;
          expect(removed, `${e.id} carries ${key}`).toBeDefined();
          const problems = diffShape(shape, rest);
          expect(problems, `${e.id} without ${key}`).toContain(`missing $.${key}`);
        }
      },
    );

    it.each(jsonEndpoints.map((e) => [e.id, e] as const))(
      '%s: an extra field in the fake answer fails',
      (_id, e) => {
        const body = JSON.parse(exchangeOf(e).responseText) as Record<string, unknown>;
        const problems = diffShape(e.response as ObjNode, { ...body, surprise_field: 1 });
        expect(problems).toContain('extra $.surprise_field');
      },
    );

    it('a request body field the fake does not read fails the request check', () => {
      const e = ENDPOINTS.find((x) => x.id === 'capture');
      const request = e?.request;
      expect(request).toBeDefined();
      const body = JSON.parse(
        e === undefined ? '{}' : (exchangeOf(e).requestBody ?? '{}'),
      ) as Record<string, unknown>;
      const problems = diffShape(request as ObjNode, { ...body, note_to_payer: 'x' });
      expect(problems).toContain('extra $.note_to_payer');
    });
  });
});
