import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createWebhookRoute,
  portFromService,
  type WebhookPort,
  type WebhookResult,
} from '../src/http/webhook';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

async function serve(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
): Promise<string> {
  const server = createServer((req, res) => void handler(req, res));
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return 'http://127.0.0.1:' + String((server.address() as AddressInfo).port);
}

function post(url: string, body: Uint8Array, headers: Record<string, string> = {}) {
  return fetch(url + '/webhooks/paypal', { method: 'POST', body, headers });
}

describe('webhook route', () => {
  it('hands byte-exact raw body and headers to the port (T-RT-081)', async () => {
    const seen: { raw: Buffer; sig: string | undefined }[] = [];
    const port: WebhookPort = {
      handleWebhook(req) {
        seen.push({ raw: Buffer.from(req.rawBody), sig: req.headers['x-test-sig'] });
        return Promise.resolve({ kind: 'ok' });
      },
    };
    const base = await serve(createWebhookRoute(port));
    const text = '{ "id" :\t"EVT-1",\r\n  "n": 1.0 }  \n';
    const odd = Buffer.concat([Buffer.from(text, 'utf8'), Buffer.from([0xc3, 0xa9])]);
    const res = await post(base, odd, { 'x-test-sig': 'placeholder-sig' });
    expect(res.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.raw.equals(odd)).toBe(true);
    expect(seen[0]?.sig).toBe('placeholder-sig');
  });

  it('maps ok, duplicate, invalid_signature, retry to 200, 200, 400, 503 (T-RT-082)', async () => {
    const results: WebhookResult[] = [
      { kind: 'ok' },
      { kind: 'duplicate' },
      { kind: 'invalid_signature' },
      { kind: 'retry', reason: 'store down' },
    ];
    const port: WebhookPort = {
      handleWebhook: () => Promise.resolve(results.shift() ?? { kind: 'ok' }),
    };
    const base = await serve(createWebhookRoute(port));
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await post(base, Buffer.from('{}'))).status);
    expect(statuses).toEqual([200, 200, 400, 503]);
  });

  it('answers 503 when the port throws, and 405 for other methods', async () => {
    const port: WebhookPort = { handleWebhook: () => Promise.reject(new Error('boom')) };
    const base = await serve(createWebhookRoute(port));
    expect((await post(base, Buffer.from('{}'))).status).toBe(503);
    expect((await fetch(base + '/webhooks/paypal')).status).toBe(405);
  });

  it('adapts the service status: 200, 401 and 503', async () => {
    const statuses = [200, 401, 503];
    const port = portFromService({
      handleWebhook: () => Promise.resolve({ status: statuses.shift() ?? 503 }),
    });
    const req = { rawBody: Buffer.from('{}'), headers: {} };
    expect((await port.handleWebhook(req)).kind).toBe('ok');
    expect((await port.handleWebhook(req)).kind).toBe('invalid_signature');
    expect((await port.handleWebhook(req)).kind).toBe('retry');
  });
});
