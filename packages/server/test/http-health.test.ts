import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createHealthRoutes,
  createRootRoute,
  createVersionRoute,
  resolveSha,
} from '../src/http/health';

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

describe('root route', () => {
  it('answers GET and HEAD / with the signpost JSON and no secrets', async () => {
    const route = createRootRoute();
    const server = createServer((req, res) => void route(req, res));
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = 'http://127.0.0.1:' + String((server.address() as AddressInfo).port);
    const res = await fetch(base + '/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(await res.json()).toEqual({
      name: 'GAVEL API',
      note: 'PayPal sandbox only. No real money moves.',
      web: 'https://gavel.dualmindlab.tech/try',
      docs: 'https://docs.gavel.dualmindlab.tech',
      apiReference: 'https://docs.gavel.dualmindlab.tech/api-reference',
      openapi: 'https://docs.gavel.dualmindlab.tech/openapi.yaml',
      health: '/healthz',
      version: '/version',
    });
    const head = await fetch(base + '/', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
  });

  it('builds the web link from a configured origin', async () => {
    const route = createRootRoute({ webOrigin: 'http://localhost:5173/' });
    const server = createServer((req, res) => void route(req, res));
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = 'http://127.0.0.1:' + String((server.address() as AddressInfo).port);
    const body = (await (await fetch(base + '/')).json()) as { web: string };
    expect(body.web).toBe('http://localhost:5173/try');
  });
});
