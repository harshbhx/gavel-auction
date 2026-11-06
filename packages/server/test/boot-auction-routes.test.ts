import { SystemClock } from '@gavel/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { composeServer, type Composed } from '../src/boot/compose';

const KEY = 'test-admin-key-test-admin-key';
const env = {
  PUBLIC_URL: 'http://localhost:8080',
  TOKEN_SECRET: 'test-secret-test-secret-test-secret-0123',
  ADMIN_KEY: KEY,
  PAYMENTS: 'fake',
  LOG_LEVEL: 'info',
};

const running: Composed[] = [];
afterEach(async () => {
  for (const app of running.splice(0)) await app.close();
});

/** Boots exactly as main.ts does: no extraRoutes option. */
async function boot(): Promise<string> {
  const app = await composeServer(env, { sink: () => undefined });
  running.push(app);
  return `http://127.0.0.1:${String(await app.listen(0))}`;
}

function auctionConfig(): Record<string, unknown> {
  return {
    mode: 'english',
    currency: 'USD',
    reserve: 10000,
    minIncrement: 500,
    endTs: new SystemClock().now() + 600_000,
    softCloseWindowMs: 30_000,
    softCloseExtensionMs: 30_000,
    maxExtensions: 5,
    ceilingPresets: [30000, 50000],
    confirmConfidenceThreshold: 0.85,
  };
}

describe('auction HTTP routes in the production composition (HRD-50)', () => {
  it('creates an auction and reads it back over HTTP', async () => {
    const url = await boot();
    const created = await fetch(`${url}/api/auctions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-key': KEY },
      body: JSON.stringify({ title: 'Boot test', config: auctionConfig() }),
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { auctionId: string; auctioneerLink: string };
    expect(body.auctionId).toMatch(/^[0-9A-Z]{26}$/);
    const read = await fetch(`${url}/api/auctions/${body.auctionId}`);
    expect(read.status).toBe(200);
    const got = (await read.json()) as { auctionId: string; title: string };
    expect(got.auctionId).toBe(body.auctionId);
    expect(got.title).toBe('Boot test');
  });

  it('keeps the admin key on create', async () => {
    const url = await boot();
    const res = await fetch(`${url}/api/auctions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'x', config: auctionConfig() }),
    });
    expect(res.status).toBe(401);
  });

  it('still answers 404 for unknown paths', async () => {
    const url = await boot();
    expect((await fetch(`${url}/api/nope`)).status).toBe(404);
  });
});
