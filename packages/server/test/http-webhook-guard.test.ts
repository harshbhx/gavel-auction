import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { WebhookPort } from '../src/http/webhook';
import {
  WEBHOOK_MAX_BYTES,
  createGuardedWebhookRoute,
  type WebhookLog,
} from '../src/http/webhook-guard';

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

function recorder() {
  const lines: { level: string; message: string; fields: Record<string, unknown> }[] = [];
  const log: WebhookLog = {
    info: (message, fields) => lines.push({ level: 'info', message, fields }),
    warn: (message, fields) => lines.push({ level: 'warn', message, fields }),
  };
  return { lines, log };
}

const okPort: WebhookPort = { handleWebhook: () => Promise.resolve({ kind: 'ok' }) };

describe('webhook guard', () => {
  it('rejects a body over 256 KiB with 413 and logs no body (T-RT-083)', async () => {
    const { lines, log } = recorder();
    let called = false;
    const port: WebhookPort = {
      handleWebhook: () => {
        called = true;
        return Promise.resolve({ kind: 'ok' });
      },
    };
    const base = await serve(createGuardedWebhookRoute(port, { log }));
    const big = Buffer.alloc(WEBHOOK_MAX_BYTES + 1, 0x61);
    const res = await fetch(base + '/webhooks/paypal', { method: 'POST', body: big });
    expect(res.status).toBe(413);
    expect(called).toBe(false);
    expect(JSON.stringify(lines)).not.toContain('aaaa');
  });

  it('accepts exactly 256 KiB', async () => {
    const { log } = recorder();
    const base = await serve(createGuardedWebhookRoute(okPort, { log }));
    const body = Buffer.alloc(WEBHOOK_MAX_BYTES, 0x61);
    const res = await fetch(base + '/webhooks/paypal', { method: 'POST', body });
    expect(res.status).toBe(200);
  });

  it('logs event id and outcome only, never body or headers (T-RT-083)', async () => {
    const { lines, log } = recorder();
    const base = await serve(createGuardedWebhookRoute(okPort, { log }));
    const body = JSON.stringify({ id: 'WH-EVT-7', secretish: 'payer-private-value' });
    await fetch(base + '/webhooks/paypal', {
      method: 'POST',
      body,
      headers: { 'paypal-transmission-sig': 'placeholder-signature' },
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.fields).toEqual({ eventId: 'WH-EVT-7', outcome: 'ok' });
    const text = JSON.stringify(lines);
    expect(text).not.toContain('payer-private-value');
    expect(text).not.toContain('placeholder-signature');
  });

  it('answers 200 with a warning for an unknown auction (T-RT-085)', async () => {
    const { lines, log } = recorder();
    const port: WebhookPort = {
      handleWebhook: () => Promise.resolve({ kind: 'ok', auctionId: 'auc-missing' as never }),
    };
    const base = await serve(
      createGuardedWebhookRoute(port, { log, knownAuction: () => Promise.resolve(false) }),
    );
    const res = await fetch(base + '/webhooks/paypal', {
      method: 'POST',
      body: JSON.stringify({ id: 'WH-EVT-8' }),
    });
    expect(res.status).toBe(200);
    expect(lines.some((l) => l.level === 'warn' && l.fields['eventId'] === 'WH-EVT-8')).toBe(true);
  });

  it('turns a retry for an unknown auction into 200', async () => {
    const { lines, log } = recorder();
    const port: WebhookPort = {
      handleWebhook: () => Promise.resolve({ kind: 'retry', reason: 'unknown_auction' }),
    };
    const base = await serve(createGuardedWebhookRoute(port, { log }));
    const res = await fetch(base + '/webhooks/paypal', { method: 'POST', body: '{"id":"E1"}' });
    expect(res.status).toBe(200);
    expect(lines[0]?.level).toBe('warn');
  });
});
