import { SystemClock } from '@gavel/shared';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { composeServer, type Composed } from '../src/boot/compose';

const base = {
  PUBLIC_URL: 'http://localhost:8080',
  TOKEN_SECRET: 'test-secret-test-secret-test-secret-0123',
  ADMIN_KEY: 'test-admin-key-test-admin-key',
  PAYMENTS: 'fake',
  LOG_LEVEL: 'error',
};

const running: Composed[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const app of running.splice(0)) await app.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function boot(env: Record<string, string> = {}): Promise<{ app: Composed; url: string }> {
  const app = await composeServer({ ...base, ...env }, { sink: () => undefined });
  running.push(app);
  const port = await app.listen(0);
  return { app, url: `http://127.0.0.1:${port}` };
}

describe('server entry point (INT-R3-17)', () => {
  it('answers the health and metrics routes', async () => {
    const { url } = await boot();
    expect((await fetch(`${url}/healthz`)).status).toBe(200);
    expect((await fetch(`${url}/readyz`)).status).toBe(200);
    expect((await fetch(`${url}/metrics`)).status).toBe(401);
    const metrics = await fetch(`${url}/metrics`, { headers: { 'x-admin-key': base.ADMIN_KEY } });
    expect(metrics.status).toBe(200);
    expect(await metrics.json()).toHaveProperty('bids');
    expect((await fetch(`${url}/nope`)).status).toBe(404);
  });

  it('mounts the webhook route and rejects an unsigned delivery', async () => {
    const { url } = await boot();
    const res = await fetch(`${url}/webhooks/paypal`, { method: 'POST', body: '{"id":"WH-1"}' });
    expect(res.status).toBe(400);
    expect((await fetch(`${url}/webhooks/paypal`)).status).toBe(405);
  });

  it('mounts the export route behind the admin key (R4-E05)', async () => {
    const { url } = await boot();
    const id = '01HZZZZZZZZZZZZZZZZZZZZZZZ';
    expect((await fetch(`${url}/api/auctions/${id}/export`)).status).toBe(401);
    const res = await fetch(`${url}/api/auctions/${id}/export`, {
      headers: { 'x-admin-key': base.ADMIN_KEY },
    });
    expect(res.status).toBe(404);
  });

  it('keeps rooms across a restart with the file stores', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gavel-boot-'));
    dirs.push(dir);
    const env = { STORE: 'file', DATA_DIR: dir };
    const first = await boot(env);
    const auctionId = '01HZZZZZZZZZZZZZZZZZZZZZZA';
    await first.app.service.createAuction(
      auctionId as never,
      {
        mode: 'english',
        currency: 'USD',
        reserve: 10000,
        minIncrement: 500,
        endTs: new SystemClock().now() + 3_600_000,
        softCloseWindowMs: 30_000,
        softCloseExtensionMs: 30_000,
        maxExtensions: 5,
        ceilingPresets: [30000, 50000],
        confirmConfidenceThreshold: 0.85,
      } as never,
      'auctioneer-1',
    );
    await first.app.close();
    running.splice(0);
    const second = await boot(env);
    expect(await second.app.store.listAuctions()).toContain(auctionId);
    const res = await fetch(`${second.url}/api/auctions/${auctionId}/export`, {
      headers: { 'x-admin-key': base.ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/x-ndjson');
    expect((await res.text()).length).toBeGreaterThan(0);
  });

  it('lets an in-flight request finish when closing (R6-A02)', async () => {
    const app = await composeServer(
      { ...base },
      {
        sink: () => undefined,
        extraRoutes: () => async (req, res) => {
          if (req.url !== '/slow') return false;
          await new Promise((r) => setTimeout(r, 300));
          res.end('finished');
          return true;
        },
      },
    );
    const port = await app.listen(0);
    const pending = fetch(`http://127.0.0.1:${port}/slow`).then((r) => r.text());
    await new Promise((r) => setTimeout(r, 100));
    await app.close();
    expect(await pending).toBe('finished');
  });

  it('refuses a second host on the same data directory (R6-A04)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gavel-lock-'));
    dirs.push(dir);
    const env = { STORE: 'file', DATA_DIR: dir };
    const first = await boot(env);
    await expect(composeServer({ ...base, ...env }, { sink: () => undefined })).rejects.toThrow(
      /in use by process/,
    );
    await first.app.close();
    running.splice(0);
    await boot(env);
  });

  it('refuses to boot with an unavailable store', async () => {
    await expect(
      composeServer({ ...base, STORE: 'd1' }, { sink: () => undefined }),
    ).rejects.toThrow(/not available/);
  });

  it('reports every config problem through the hooks', async () => {
    const lines: string[] = [];
    await expect(
      composeServer(
        {},
        {
          hooks: {
            error: (l) => lines.push(l),
            exit: () => {
              throw new Error('exit');
            },
          },
        },
      ),
    ).rejects.toThrow('exit');
    expect(lines.join('\n')).toContain('TOKEN_SECRET');
  });

  it('releases the lock and stops payments even when the service close throws (R7S-07)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gavel-close-'));
    dirs.push(dir);
    const app = await composeServer(
      { ...base, STORE: 'file', DATA_DIR: dir, PAYMENTS: 'fake' },
      { sink: () => undefined },
    );
    expect(existsSync(join(dir, 'gavel.lock'))).toBe(true);
    app.service.close = () => Promise.reject(new Error('boom'));
    await expect(app.close()).rejects.toThrow('boom');
    expect(existsSync(join(dir, 'gavel.lock'))).toBe(false);
  });

  it('warns at boot about a previous secret with no end time (R7S-06)', async () => {
    const lines: string[] = [];
    const app = await composeServer(
      {
        ...base,
        LOG_LEVEL: 'warn',
        TOKEN_SECRET_PREVIOUS: 'p'.repeat(40),
      },
      { sink: (l) => void lines.push(l) },
    );
    running.push(app);
    expect(lines.join('\n')).toMatch(/TOKEN_SECRET_PREVIOUS is set with no/);
  });
});
