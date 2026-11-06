import { afterEach, describe, expect, it } from 'vitest';
import { composeServer, type Composed } from '../src/boot/compose';

const KEY = 'test-admin-key-test-admin-key';
const base = {
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

async function boot(extra: Record<string, string>): Promise<string> {
  const app = await composeServer({ ...base, ...extra }, { sink: () => undefined });
  running.push(app);
  return `http://127.0.0.1:${String(await app.listen(0))}`;
}

const post = (url: string, headers: Record<string, string> = {}) =>
  fetch(url, { method: 'POST', headers });

describe('demo routes in the production composition (HRD-61)', () => {
  it('answers 404 when DEMO_MODE is off', async () => {
    const url = await boot({});
    expect((await post(`${url}/api/demo/rooms`, { 'x-admin-key': KEY })).status).toBe(404);
  });

  it('refuses the flag under a production-like public URL', async () => {
    await expect(
      boot({ DEMO_MODE: '1', PUBLIC_URL: 'https://gavel.example.com', NODE_ENV: 'production' }),
    ).rejects.toBeDefined();
  });

  it('needs the admin key when DEMO_MODE=1', async () => {
    const url = await boot({ DEMO_MODE: '1' });
    expect((await post(`${url}/api/demo/rooms`)).status).toBe(401);
  });

  it('creates a live room with three seeded bidders', async () => {
    const url = await boot({ DEMO_MODE: '1' });
    const res = await post(`${url}/api/demo/rooms`, { 'x-admin-key': KEY });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { auctionId: string; bidders: number };
    expect(body.bidders).toBe(3);
    const read = await fetch(`${url}/api/auctions/${body.auctionId}`);
    expect(read.status).toBe(200);
    const second = await post(`${url}/api/demo/seed`, { 'x-admin-key': KEY });
    expect(second.status).toBe(200);
    expect(((await second.json()) as { auctionId: string }).auctionId).not.toBe(body.auctionId);
  });
});
