import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebhookVerifier } from '@gavel/payments';
import { DEFAULT_FAKE_WEBHOOK_ID } from '@gavel/payments/fake';
import {
  FAKE_AUTH_ALGO,
  FAKE_CERT_URL,
  WebhookEmitter,
  signWebhook,
  // The fake entry point does not re-export the signing helpers, and the package exports map hides src.
} from '../../../payments/src/fake/webhooks';
import { WEBHOOK_MAX_BYTES, createGuardedWebhookRoute } from '@gavel/server/src/http/webhook-guard';
import { portFromService } from '@gavel/server/src/http/webhook';
import { makeRig, type Rig } from '../flow/rig';

// T-QA-072 (R-QA-036): unsigned, tampered, wrong certificate host and stale deliveries are answered
// 400 and leave no stored event; a delivery signed with the fake verifier key is answered 200.
// Only the fake verifier key is used; nothing here reaches a real PayPal host.

const servers: Server[] = [];
const open: Array<{ stop(): Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
  for (const p of open.splice(0)) await p.stop();
});

const quietLog = { info: () => undefined, warn: () => undefined };

interface Delivery {
  rawBody: string;
  headers: Record<string, string>;
}

interface Setup {
  rig: Rig;
  base: string;
  signed: () => Delivery;
}

async function setup(verifier?: WebhookVerifier): Promise<Setup> {
  const rig = await makeRig();
  open.push(rig.paypal);
  const service = rig.service(verifier === undefined ? {} : { verifier });
  const route = createGuardedWebhookRoute(portFromService(service), { log: quietLog });
  const server = createServer((req, res) => void route(req, res));
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + String((server.address() as AddressInfo).port);
  const emitter = new WebhookEmitter({
    webhookId: DEFAULT_FAKE_WEBHOOK_ID,
    nowMs: () => rig.paypal.core.clock.nowMs(),
  });
  const signed = (): Delivery => {
    const order = rig.paypal.core.createOrder(
      { holdId: 'hold-sec', amountCents: 5000, description: 'sandbox' },
      'req-sec',
    );
    rig.paypal.core.approveOrder(order.id);
    const event = rig.paypal.core.events.at(-1);
    if (event === undefined) throw new Error('no event emitted');
    return emitter.sign(event);
  };
  return { rig, base, signed };
}

function post(base: string, d: Delivery | { rawBody: string; headers?: Record<string, string> }) {
  return fetch(base + '/webhooks/paypal', {
    method: 'POST',
    body: d.rawBody,
    headers: d.headers ?? {},
  });
}

async function noEventStored(rig: Rig): Promise<void> {
  expect(await rig.stores.webhookEvents.listUnprocessed()).toEqual([]);
}

describe('webhook signature checks over HTTP (T-QA-072)', () => {
  it('answers 200 to a delivery signed with the fake verifier key', async () => {
    const { base, signed } = await setup();
    expect((await post(base, signed())).status).toBe(200);
  });

  it('answers 400 to an unsigned delivery and to one with a missing header', async () => {
    const { rig, base, signed } = await setup();
    const d = signed();
    expect((await post(base, { rawBody: d.rawBody })).status).toBe(400);
    for (const name of Object.keys(d.headers)) {
      const rest = Object.fromEntries(Object.entries(d.headers).filter(([k]) => k !== name));
      expect((await post(base, { rawBody: d.rawBody, headers: rest })).status).toBe(400);
    }
    await noEventStored(rig);
  });

  it('answers 400 to a tampered body and to a wrong signature', async () => {
    const { rig, base, signed } = await setup();
    const d = signed();
    const tampered = d.rawBody.replace('"event_version":"1.0"', '"event_version":"9.9"');
    expect(tampered).not.toBe(d.rawBody);
    expect((await post(base, { rawBody: tampered, headers: d.headers })).status).toBe(400);
    const badSig = { ...d.headers, 'PAYPAL-TRANSMISSION-SIG': 'AAAA' + 'A'.repeat(40) };
    expect((await post(base, { rawBody: d.rawBody, headers: badSig })).status).toBe(400);
    await noEventStored(rig);
  });

  it('answers 400 to a delivery signed for another webhook id', async () => {
    const { rig, base, signed } = await setup();
    const d = signed();
    const time = d.headers['PAYPAL-TRANSMISSION-TIME'] ?? '';
    const sig = signWebhook({
      transmissionId: d.headers['PAYPAL-TRANSMISSION-ID'] ?? '',
      transmissionTime: time,
      webhookId: 'WH-SOMEONE-ELSE',
      rawBody: d.rawBody,
    });
    const headers = { ...d.headers, 'PAYPAL-TRANSMISSION-SIG': sig };
    expect((await post(base, { rawBody: d.rawBody, headers })).status).toBe(400);
    await noEventStored(rig);
  });

  it('answers 400 to bodies that are not a single JSON object', async () => {
    const { rig, base, signed } = await setup();
    const d = signed();
    for (const rawBody of ['', 'not json', '[]', '{"a":1}{"b":2}', 'null']) {
      expect((await post(base, { rawBody, headers: d.headers })).status).toBe(400);
    }
    await noEventStored(rig);
  });

  it('answers 413 to a body over the size limit before any verification', async () => {
    const { rig, base } = await setup();
    const res = await post(base, { rawBody: 'x'.repeat(WEBHOOK_MAX_BYTES + 1) });
    expect(res.status).toBe(413);
    await noEventStored(rig);
  });
});

describe('webhook checks that need the live rules (T-QA-072)', () => {
  const NOW = 1_789_000_000_000;
  const neverCalled = {
    send: (): Promise<never> => Promise.reject(new Error('PayPal must not be called')),
  };
  const liveRules = () =>
    new WebhookVerifier({
      auth: neverCalled,
      webhookId: DEFAULT_FAKE_WEBHOOK_ID,
      nowMs: () => NOW,
    });

  function delivery(over: Record<string, string>): Delivery {
    const rawBody = '{"id":"WH-EVT-1","event_type":"CHECKOUT.ORDER.APPROVED","resource":{}}';
    return {
      rawBody,
      headers: {
        'PAYPAL-AUTH-ALGO': 'SHA256withRSA',
        'PAYPAL-CERT-URL': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1',
        'PAYPAL-TRANSMISSION-ID': 'TX-live-1',
        'PAYPAL-TRANSMISSION-SIG': 'QUJDREVGR0hJSktMTU5PUA==',
        'PAYPAL-TRANSMISSION-TIME': new Date(NOW).toISOString(),
        ...over,
      },
    };
  }

  it.each([
    [
      'a certificate host that is not PayPal',
      { 'PAYPAL-CERT-URL': 'https://paypal.com.evil.test/c' },
    ],
    [
      'a certificate host with a PayPal suffix trick',
      { 'PAYPAL-CERT-URL': 'https://evilpaypal.com/c' },
    ],
    ['a certificate url over plain http', { 'PAYPAL-CERT-URL': 'http://api.paypal.com/c' }],
    [
      'a certificate url with credentials',
      { 'PAYPAL-CERT-URL': 'https://user:pw@api.paypal.com/c' },
    ],
    ['an unknown signature algorithm', { 'PAYPAL-AUTH-ALGO': 'none' }],
    [
      'a transmission time an hour old',
      { 'PAYPAL-TRANSMISSION-TIME': new Date(NOW - 3_600_000).toISOString() },
    ],
    [
      'a transmission time an hour ahead',
      { 'PAYPAL-TRANSMISSION-TIME': new Date(NOW + 3_600_000).toISOString() },
    ],
    ['an unparseable transmission time', { 'PAYPAL-TRANSMISSION-TIME': 'yesterday' }],
  ])('answers 400 without calling PayPal for %s', async (_name, over) => {
    const { rig, base } = await setup(liveRules());
    const d = delivery(over);
    expect((await post(base, d)).status).toBe(400);
    await noEventStored(rig);
  });

  it('keeps the fake verifier constants out of a live-rules verifier', async () => {
    const { base } = await setup(liveRules());
    const d = delivery({
      'PAYPAL-AUTH-ALGO': FAKE_AUTH_ALGO,
      'PAYPAL-CERT-URL': FAKE_CERT_URL,
    });
    expect((await post(base, d)).status).toBe(400);
  });
});
