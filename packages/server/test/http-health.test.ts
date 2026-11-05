import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createHealthRoutes, createVersionRoute, resolveSha } from '../src/http/health';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

describe('health routes', () => {
  it('healthz is always 200; readyz follows migrations and the store (T-RT-093)', async () => {
    let migrated = false;
    let storeUp = true;
    const routes = createHealthRoutes({
      migrationsApplied: () => migrated,
      pingStore: () => (storeUp ? Promise.resolve() : Promise.reject(new Error('down'))),
    });
    const server = createServer((req, res) => {
      void (req.url === '/healthz' ? routes.healthz(req, res) : routes.readyz(req, res));
    });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = 'http://127.0.0.1:' + String((server.address() as AddressInfo).port);
    const status = async (path: string) => (await fetch(base + path)).status;

    expect(await status('/healthz')).toBe(200);
    expect(await status('/readyz')).toBe(503);
    migrated = true;
    expect(await status('/readyz')).toBe(200);
    storeUp = false;
    expect(await status('/readyz')).toBe(503);
    expect(await status('/healthz')).toBe(200);
    storeUp = true;
    expect(await status('/readyz')).toBe(200);
  });
});

describe('version route', () => {
  it('resolves a sha from the environment and answers it (T-QA-082)', async () => {
    expect(resolveSha({ GAVEL_SHA: 'abc1234def' })).toBe('abc1234def');
    expect(resolveSha({ RENDER_GIT_COMMIT: '0123456789abcdef0123456789abcdef01234567' })).toBe(
      '0123456789abcdef0123456789abcdef01234567',
    );
    expect(resolveSha({ GAVEL_SHA: 'not a sha' })).toBe('unknown');
    expect(resolveSha({})).toBe('unknown');
    const route = createVersionRoute('abc1234');
    const server = createServer((req, res) => void route(req, res));
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = 'http://127.0.0.1:' + String((server.address() as AddressInfo).port);
    const res = await fetch(base + '/version');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sha: 'abc1234' });
  });
});
