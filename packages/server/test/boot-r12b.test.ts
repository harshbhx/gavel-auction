import type { IncomingMessage } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { composeServer, type Composed } from '../src/boot/compose';
import { sourceOf } from '../src/http/webhook';

const base = {
  PUBLIC_URL: 'http://localhost:8080',
  TOKEN_SECRET: 'test-secret-test-secret-test-secret-0123',
  ADMIN_KEY: 'test-admin-key-test-admin-key',
  PAYMENTS: 'fake',
  LOG_LEVEL: 'error',
};

const running: Composed[] = [];
afterEach(async () => {
  for (const app of running.splice(0)) await app.close();
});

async function boot(env: Record<string, string> = {}): Promise<string> {
  const app = await composeServer({ ...base, ...env }, { sink: () => undefined });
  running.push(app);
  return `http://127.0.0.1:${await app.listen(0)}`;
}

describe('HTTP rate limit (R12-S11)', () => {
  it('answers 429 with retry-after once the burst is spent, and never limits probes', async () => {
    const url = await boot({
      RATE_HTTP_BURST: '2',
      RATE_HTTP_PER_MIN: '1',
      RATE_HTTP_READ_BURST: '2',
      RATE_HTTP_READ_PER_MIN: '1',
    });
    expect((await fetch(`${url}/nope`)).status).toBe(404);
    expect((await fetch(`${url}/nope`)).status).toBe(404);
    const limited = await fetch(`${url}/nope`);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect((await fetch(`${url}/healthz`)).status).toBe(200);
    // Webhook deliveries are exempt.
    expect((await fetch(`${url}/webhooks/paypal`, { method: 'POST', body: '{}' })).status).toBe(
      400,
    );
  });

  it('keys the limit on the client address behind the proxy (R12-S03)', async () => {
    const url = await boot({
      RATE_HTTP_BURST: '1',
      RATE_HTTP_PER_MIN: '1',
      RATE_HTTP_READ_BURST: '1',
      RATE_HTTP_READ_PER_MIN: '1',
      TRUSTED_PROXY_HOPS: '1',
    });
    const as = (ip: string) => fetch(`${url}/nope`, { headers: { 'x-forwarded-for': ip } });
    expect((await as('203.0.113.1')).status).toBe(404);
    expect((await as('203.0.113.1')).status).toBe(429);
    expect((await as('203.0.113.2')).status).toBe(404);
  });
});

describe('429 answers a browser can read (SRV-37)', () => {
  const origin = 'http://localhost:8080';
  it('carries the CORS headers and a retry-after on the 429 and the 404', async () => {
    const url = await boot({
      CORS_ORIGINS: origin,
      RATE_HTTP_READ_BURST: '1',
      RATE_HTTP_READ_PER_MIN: '1',
    });
    const get = () => fetch(`${url}/nope`, { headers: { origin } });
    const ok = await get();
    expect(ok.status).toBe(404);
    expect(ok.headers.get('access-control-allow-origin')).toBe(origin);
    const limited = await get();
    expect(limited.status).toBe(429);
    expect(limited.headers.get('access-control-allow-origin')).toBe(origin);
    expect(limited.headers.get('access-control-expose-headers')).toContain('retry-after');
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    const other = await fetch(`${url}/nope`, { headers: { origin: 'http://evil.example' } });
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('gives the docs origin the same readable 429 on the judge routes only (#2423)', async () => {
    const docs = 'https://docs.gavel.dualmindlab.tech';
    const url = await boot({ RATE_HTTP_READ_BURST: '1', RATE_HTTP_READ_PER_MIN: '1' });
    const get = (path: string) => fetch(`${url}${path}`, { headers: { origin: docs } });
    const first = await get('/api/judge/capabilities');
    expect(first.headers.get('access-control-allow-origin')).toBe(docs);
    const limited = await get('/api/judge/capabilities');
    expect(limited.status).toBe(429);
    expect(limited.headers.get('access-control-allow-origin')).toBe(docs);
    expect(limited.headers.get('access-control-expose-headers')).toContain('retry-after');
    const elsewhere = await get('/api/auctions/abc/snapshot');
    expect(elsewhere.status).toBe(429);
    expect(elsewhere.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('keeps writes on their own, tighter bucket than public reads', async () => {
    const url = await boot({ RATE_HTTP_BURST: '1', RATE_HTTP_PER_MIN: '1' });
    for (let i = 0; i < 5; i += 1) expect((await fetch(`${url}/nope`)).status).toBe(404);
    const post = () => fetch(`${url}/nope`, { method: 'POST', body: '{}' });
    expect((await post()).status).toBe(404);
    expect((await post()).status).toBe(429);
  });
});

describe('ledger export route (R12-S12)', () => {
  it('is routed behind the admin key and answers 404 for an unknown auction', async () => {
    const url = await boot();
    const id = '01HZZZZZZZZZZZZZZZZZZZZZZZ';
    expect((await fetch(`${url}/admin/export?auction=${id}`)).status).toBe(401);
    const headers = { 'x-admin-key': base.ADMIN_KEY };
    expect((await fetch(`${url}/admin/export?auction=${id}`, { headers })).status).toBe(404);
    expect((await fetch(`${url}/admin/export?auctionId=${id}`, { headers })).status).toBe(404);
    expect((await fetch(`${url}/admin/export`, { headers })).status).toBe(400);
  });
});

describe('webhook source behind a proxy (R12-S03)', () => {
  const req = (xff: string): IncomingMessage =>
    ({ headers: { 'x-forwarded-for': xff }, socket: { remoteAddress: '10.0.0.9' } }) as never;
  it('uses the address the trusted proxy saw, not the proxy', () => {
    expect(sourceOf(req('198.51.100.7, 203.0.113.5'), 1)).toBe('203.0.113.5');
    expect(sourceOf(req('198.51.100.7'), 0)).toBe('10.0.0.9');
  });
});
