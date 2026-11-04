import { readFileSync, readdirSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeControl, FakeControlServer } from '../../src/fake/control.js';
import { FakePayPalServer } from '../../src/fake/server.js';
import { buildVerifyRequest, verifyFakeWebhook } from '../../src/fake/webhooks.js';

let server: FakePayPalServer;
let control: FakeControlServer;

const noSleep = async (): Promise<void> => undefined;

beforeEach(async () => {
  server = new FakePayPalServer({ timers: { sleep: noSleep } });
  await server.start();
  control = new FakeControlServer(server, { sleep: noSleep });
  await control.start();
});

afterEach(async () => {
  await control.stop();
  await server.stop();
});

async function call(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${control.url}${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

function newOrder(holdId = 'hold-1'): string {
  return server.core.createOrder({ holdId, amountCents: 5000, description: 'd' }, `req-${holdId}`)
    .id;
}

describe('approve', () => {
  it('moves an order to APPROVED so it can be authorized', async () => {
    const orderId = newOrder();
    const r = await call('POST', `/__fake/approve/${orderId}`);
    expect(r.status).toBe(200);
    expect(r.json['status']).toBe('APPROVED');
    expect(server.core.authorizeOrder(orderId, 'req-a').authId).not.toBe('');
  });

  it('answers 404 for an unknown order', async () => {
    const r = await call('POST', '/__fake/approve/NO-SUCH');
    expect(r.status).toBe(404);
  });
});

describe('clock', () => {
  it('advances by ms, hours and days', async () => {
    const before = server.core.clock.nowMs();
    const r = await call('POST', '/__fake/clock/advance', { days: 1, hours: 2, ms: 5 });
    expect(r.status).toBe(200);
    expect(server.core.clock.nowMs()).toBe(before + 86_400_000 + 7_200_000 + 5);
    expect(r.json['nowMs']).toBe(server.core.clock.nowMs());
  });

  it('refuses an empty, negative or malformed request', async () => {
    expect((await call('POST', '/__fake/clock/advance', {})).status).toBe(400);
    expect((await call('POST', '/__fake/clock/advance', { ms: -1 })).status).toBe(400);
    expect((await call('POST', '/__fake/clock/advance', { ms: 'soon' })).status).toBe(400);
  });
});

describe('inject', () => {
  it('arms a fault that the next matching call meets', async () => {
    const r = await call('POST', '/__fake/inject', { kind: 'http_500', op: 'order' });
    expect(r.status).toBe(200);
    expect(r.json['pending']).toBe(1);
    const token = await fetch(`${server.url}/v1/oauth2/token`, {
      method: 'POST',
      body: 'grant_type=client_credentials',
    }).then((x) => x.json() as Promise<{ access_token: string }>);
    const res = await fetch(`${server.url}/v2/checkout/orders`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token.access_token}` },
      body: JSON.stringify({
        intent: 'AUTHORIZE',
        purchase_units: [{ custom_id: 'h', amount: { currency_code: 'USD', value: '10.00' } }],
      }),
    });
    expect(res.status).toBe(500);
    const state = await call('GET', '/__fake/state');
    expect(state.json['pendingFaults']).toBe(0);
    expect(state.json['appliedFaults']).toHaveLength(1);
  });

  it('refuses unknown kinds and operations', async () => {
    expect((await call('POST', '/__fake/inject', { kind: 'meteor', op: 'order' })).status).toBe(
      400,
    );
    expect((await call('POST', '/__fake/inject', { kind: 'http_500', op: 'nope' })).status).toBe(
      400,
    );
    expect(
      (await call('POST', '/__fake/inject', { kind: 'capture_declined', op: 'void' })).status,
    ).toBe(400);
  });
});

describe('webhooks/deliver', () => {
  it('returns signed deliveries that pass the fake verify endpoint, original bytes intact', async () => {
    const orderId = newOrder();
    await call('POST', `/__fake/approve/${orderId}`);
    server.core.authorizeOrder(orderId, 'req-a');
    const r = await call('POST', '/__fake/webhooks/deliver', { duplicate: true });
    const deliveries = r.json['deliveries'] as Array<{
      eventId: string;
      copy: number;
      headers: Record<string, string>;
      rawBody: string;
    }>;
    expect(deliveries.length).toBe(server.core.events.length * 2);
    for (const d of deliveries) {
      const verify = buildVerifyRequest(
        { eventId: d.eventId, headers: d.headers, rawBody: d.rawBody },
        r.json['webhookId'] as string,
      );
      expect(verifyFakeWebhook(verify, r.json['webhookId'] as string).verification_status).toBe(
        'SUCCESS',
      );
    }
  });

  it('applies order and drop options', async () => {
    const o1 = newOrder('h1');
    const o2 = newOrder('h2');
    server.core.approveOrder(o1);
    server.core.approveOrder(o2);
    const ids = server.core.events.map((e) => e.id);
    const rev = await call('POST', '/__fake/webhooks/deliver', { order: 'reverse' });
    const revIds = (rev.json['deliveries'] as Array<{ eventId: string }>).map((d) => d.eventId);
    expect(revIds).toEqual([...ids].reverse());
    const dropped = await call('POST', '/__fake/webhooks/deliver', { drop: [ids[0]] });
    expect(dropped.json['deliveries']).toHaveLength(ids.length - 1);
    expect((await call('POST', '/__fake/webhooks/deliver', { order: 'sideways' })).status).toBe(
      400,
    );
  });

  describe('to a receiver', () => {
    let receiver: Server;
    let received: Array<{ body: string; sig: string | undefined }>;
    let receiverUrl: string;

    beforeEach(async () => {
      received = [];
      receiver = createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          received.push({
            body: Buffer.concat(chunks).toString('utf8'),
            sig: req.headers['paypal-transmission-sig'] as string | undefined,
          });
          res.writeHead(200);
          res.end();
        });
      });
      await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
      receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hook`;
    });

    afterEach(async () => {
      await new Promise<void>((resolve) => {
        receiver.close(() => resolve());
        receiver.closeAllConnections();
      });
    });

    it('posts every event to a loopback target', async () => {
      server.core.approveOrder(newOrder());
      const r = await call('POST', '/__fake/webhooks/deliver', { target: receiverUrl });
      expect(r.json['delivered']).toBe(1);
      expect(received).toHaveLength(1);
      expect(received[0]?.sig).toBeTruthy();
      expect(JSON.parse(received[0]?.body ?? '{}')['event_type']).toBe('CHECKOUT.ORDER.APPROVED');
    });

    it('refuses a target that is not loopback', async () => {
      const r = await call('POST', '/__fake/webhooks/deliver', {
        target: 'https://example.com/hook',
      });
      expect(r.status).toBe(400);
      expect(received).toHaveLength(0);
    });
  });
});

describe('state, invariants and reset', () => {
  it('reports clock, outbox, calls and authorization views', async () => {
    const orderId = newOrder();
    server.core.approveOrder(orderId);
    const a = server.core.authorizeOrder(orderId, 'req-a');
    server.core.capture(a.authId, 1000, false, 'req-c');
    const callsBefore = server.core.calls.length;
    const s = await call('GET', '/__fake/state');
    expect(s.status).toBe(200);
    expect(s.json['nowMs']).toBe(server.core.clock.nowMs());
    const auths = s.json['authorizations'] as Array<{ id: string; capturedCents: number }>;
    expect(auths.find((x) => x.id === a.authId)?.capturedCents).toBe(1000);
    expect(server.core.calls.length).toBe(callsBefore);
  });

  it('checks invariants', async () => {
    const ok = await call('GET', '/__fake/invariants');
    expect(ok).toEqual({ status: 200, json: { ok: true } });
  });

  it('reset starts over and keeps the listener', async () => {
    server.core.approveOrder(newOrder());
    await call('POST', '/__fake/inject', { kind: 'http_500', op: 'order' });
    expect((await call('POST', '/__fake/reset')).status).toBe(200);
    const s = await call('GET', '/__fake/state');
    expect(s.json['events']).toEqual([]);
    expect(s.json['pendingFaults']).toBe(0);
  });

  it('answers 404 for unknown control routes and 400 for bad JSON', async () => {
    expect((await call('GET', '/__fake/nothing')).status).toBe(404);
    const bad = await fetch(`${control.url}/__fake/inject`, { method: 'POST', body: '{nope' });
    expect(bad.status).toBe(400);
  });

  it('FakeControl.handle ignores paths outside /__fake/', async () => {
    const c = new FakeControl(server);
    expect(await c.handle('GET', '/v2/checkout/orders', '')).toBeUndefined();
  });
});

describe('production isolation (lint test)', () => {
  const srcDir = fileURLToPath(new URL('../../src/', import.meta.url));

  function sources(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...sources(full));
      else if (entry.name.endsWith('.ts')) out.push(full);
    }
    return out;
  }

  const outside = sources(srcDir).filter((f) => !relative(srcDir, f).startsWith('fake'));

  it('finds production sources to check', () => {
    expect(outside.length).toBeGreaterThan(5);
  });

  it('no production module imports a fake module', () => {
    const offenders = outside.filter((f) =>
      /from\s+['"][^'"]*\/fake\/[^'"]*['"]|import\(\s*['"][^'"]*\/fake\//.test(
        readFileSync(f, 'utf8'),
      ),
    );
    expect(offenders.map((f) => relative(srcDir, f))).toEqual([]);
  });

  it('no production module names a /__fake/ path', () => {
    const offenders = outside.filter((f) => readFileSync(f, 'utf8').includes('__fake'));
    expect(offenders.map((f) => relative(srcDir, f))).toEqual([]);
  });

  it('the package entry point does not export the control surface', () => {
    expect(readFileSync(join(srcDir, 'index.ts'), 'utf8')).not.toMatch(/fake/);
  });
});
