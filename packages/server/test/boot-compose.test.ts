import { SystemClock } from '@gavel/shared';
import { signToken } from '../src/auth/token';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { composeServer, type Composed } from '../src/boot/compose';

const passedHoldMaxAge: Array<number | undefined> = [];
const passedMaxCeiling: Array<number | undefined> = [];
const passedMetrics: unknown[] = [];
const passedDeps: Array<
  Parameters<typeof import('../src/runtime/auction-service').createAuctionService>[0]
> = [];
const passedLimiters: unknown[] = [];
vi.mock('../src/runtime/auction-service', async (importActual) => {
  const actual = await importActual<typeof import('../src/runtime/auction-service')>();
  return {
    ...actual,
    createAuctionService: (deps: Parameters<typeof actual.createAuctionService>[0]) => {
      passedHoldMaxAge.push(deps.holdMaxAgeMs);
      passedMaxCeiling.push(deps.maxCeilingCents);
      passedMetrics.push(deps.roomMetrics);
      passedDeps.push(deps);
      passedLimiters.push(deps.limiter);
      return actual.createAuctionService(deps);
    },
  };
});

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

describe('payments wiring in the composition (HRD-52)', () => {
  it('hands the service an audit sink that also publishes wire payloads (issue 1721)', async () => {
    const seen: string[] = [];
    const app = await composeServer(
      { ...base },
      { sink: () => undefined, onSettlementPayload: (p) => void seen.push(p.type) },
    );
    running.push(app);
    const deps = passedDeps[passedDeps.length - 1];
    await deps?.audit.append({ kind: 'kill_switch', op: 'engage', tsMs: 1 });
    expect(seen).toEqual(['audit_event']);
  });

  it('leaves reconcile, repair and reauthorization off by default (issues 1724, 1725)', async () => {
    const app = await composeServer({ ...base }, { sink: () => undefined });
    running.push(app);
    const deps = passedDeps[passedDeps.length - 1];
    expect(deps?.reconcileIntervalMs).toBeUndefined();
    expect(deps?.reconcileRepair).toBe(false);
    expect(deps?.reauthPolicy?.enabled).toBe(false);
  });

  it('turns them on from the environment (issues 1724, 1725)', async () => {
    const app = await composeServer(
      {
        ...base,
        GAVEL_RECONCILE_INTERVAL_MS: '30000',
        GAVEL_RECONCILE_REPAIR: '1',
        GAVEL_REAUTH: '1',
        GAVEL_REAUTH_HONOR_SAFE_MS: '1000',
      },
      { sink: () => undefined },
    );
    running.push(app);
    const deps = passedDeps[passedDeps.length - 1];
    expect(deps?.reconcileIntervalMs).toBe(30000);
    expect(deps?.reconcileRepair).toBe(true);
    expect(deps?.reauthPolicy).toEqual({ enabled: true, honorSafeMs: 1000 });
  });
});

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
    const root = await fetch(`${url}/`);
    expect(root.status).toBe(200);
    expect(await root.json()).toMatchObject({ name: 'GAVEL API', health: '/healthz' });
    expect((await fetch(`${url}/`, { method: 'HEAD' })).status).toBe(200);
    expect((await fetch(`${url}/`, { method: 'POST' })).status).toBe(404);
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

describe('GAVEL_HOLD_MAX_AGE_MS (R6-B01)', () => {
  it('reaches the auction service in fake mode', async () => {
    await boot({ GAVEL_HOLD_MAX_AGE_MS: '600000' });
    expect(passedHoldMaxAge.at(-1)).toBe(600000);
  });

  it('GAVEL_MAX_CEILING_CENTS reaches the auction service (QA-99)', async () => {
    await boot({ GAVEL_MAX_CEILING_CENTS: '25000' });
    expect(passedMaxCeiling.at(-1)).toBe(25000);
  });

  it('falls back to the payments default when unset', async () => {
    await boot();
    expect(passedHoldMaxAge.at(-1)).toBe(7200000);
  });

  it('feeds the metrics gauges and counters from the service (R8-S03)', async () => {
    const { app, url } = await boot();
    const read = async (): Promise<{
      rooms: number;
      connections: number;
      bids: { accepted: number };
    }> =>
      (
        await fetch(`${url}/metrics`, { headers: { 'x-admin-key': base.ADMIN_KEY } })
      ).json() as never;
    expect((await read()).rooms).toBe(0);
    await app.service.createAuction(
      '01HZZZZZZZZZZZZZZZZZZZZZZB' as never,
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
    expect((await read()).rooms).toBe(1);
    // The collector given to the service is the one behind /metrics.
    const given = passedMetrics.at(-1) as { bidAccepted(): void };
    given.bidAccepted();
    expect((await read()).bids.accepted).toBe(1);
  });

  it('gives the service a rate limiter and a mailbox gauge (HRD-15)', async () => {
    const { app } = await boot();
    expect(passedLimiters.at(-1)).toBeDefined();
    expect(app.service.stats()).toEqual({ rooms: 0, connections: 0, mailboxDepth: 0 });
  });

  it('refuses an auctioneer token whose jti was denied (R8-S04)', async () => {
    const { app, url } = await boot();
    const aud = '01HZZZZZZZZZZZZZZZZZZZZZZC';
    const jti = '01HZZZZZZZZZZZZZZZZZZZZZZD';
    const nowMs = new SystemClock().now();
    const nowS = Math.floor(nowMs / 1000);
    const token = await signToken(
      { kind: 'auctioneer', aud, sub: 'auctioneer-1', jti, iat: nowS, exp: nowS + 3600 },
      base.TOKEN_SECRET,
    );
    const get = (): Promise<Response> =>
      fetch(`${url}/api/auctions/${aud}/export`, { headers: { authorization: `Bearer ${token}` } });
    expect((await get()).status).toBe(404);
    await app.store.denyJti(jti as never, (nowMs + 3_600_000) as never);
    expect((await get()).status).toBe(401);
  });
});
