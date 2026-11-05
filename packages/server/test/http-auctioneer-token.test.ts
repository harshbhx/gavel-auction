import { ManualClock, SeqIds, type AuctionConfig, type AuctionId } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { secretSetFromConfig } from '../src/auth/rotation';
import { createHttpApp, verifyFor, type HttpApp, type HttpDeps } from '../src/http/app';
import { mountAuctioneerToken } from '../src/http/auctioneer-token';
import { mountAuctions } from '../src/http/auctions';
import { mountInvites } from '../src/http/invites';
import { Room, type RoomDeps } from '../src/room/room';
import { LedgerEngine } from '../src/runtime/ledger-engine';
import { MemoryStore } from '../src/store/memory-store';

const START = 1_789_000_000_000;
const ADMIN = 'fake-admin-key';

const config = {
  mode: 'english',
  currency: 'USD',
  reserve: 10000,
  minIncrement: 500,
  endTs: START + 600_000,
  softCloseWindowMs: 30_000,
  softCloseExtensionMs: 30_000,
  maxExtensions: 5,
  ceilingPresets: [30000, 50000],
  confirmConfidenceThreshold: 0.85,
};

function setup(): { app: HttpApp; deps: HttpDeps } {
  const clock = new ManualClock(START);
  const ids = new SeqIds();
  const store = new MemoryStore(() => clock.now());
  const rooms = new Map<string, Promise<Room>>();
  const roomDeps = (id: AuctionId): RoomDeps => ({
    store,
    clock,
    ids,
    engine: (cfg) => new LedgerEngine(id, cfg),
  });
  const deps: HttpDeps = {
    service: {
      createAuction: (id, cfg: AuctionConfig, sub) => {
        const p = Room.create(id, cfg, sub, roomDeps(id));
        rooms.set(id, p);
        return p;
      },
      room: (id) => rooms.get(id) ?? Room.load(id, roomDeps(id)),
    },
    store,
    clock,
    ids,
    secrets: secretSetFromConfig({ TOKEN_SECRET: 'fake-secret-fake-secret-fake-0000' }),
    adminKey: ADMIN,
    publicUrl: 'https://gavel.example.test',
    corsOrigins: [],
  };
  return { app: createHttpApp(deps, [mountAuctions, mountInvites, mountAuctioneerToken]), deps };
}

const tokenOf = (link: string): string => link.split('#token=')[1] ?? '';

const post = (app: HttpApp, path: string, headers: Record<string, string>, body: unknown = {}) =>
  app.fetch(
    new Request(`http://h.test${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  );

const bearer = (t: string): Record<string, string> => ({ authorization: `Bearer ${t}` });

async function created(app: HttpApp): Promise<{ id: string; token: string }> {
  const res = await post(app, '/api/auctions', { 'x-admin-key': ADMIN }, { config });
  const b = (await res.json()) as { auctionId: string; auctioneerLink: string };
  return { id: b.auctionId, token: tokenOf(b.auctioneerLink) };
}

const jtiOf = (token: string): string =>
  (
    JSON.parse(atob((token.split('.')[0] ?? '').replace(/-/g, '+').replace(/_/g, '/'))) as {
      jti: string;
    }
  ).jti;

describe('auctioneer token revoke and rotate (T-RT-062)', () => {
  it('rotate returns a working link and kills the old one on HTTP and the WS check', async () => {
    const { app, deps } = setup();
    const a = await created(app);
    const path = `/api/auctions/${a.id}/invites`;
    expect((await post(app, path, bearer(a.token))).status).toBe(201);

    const res = await post(app, `/api/auctions/${a.id}/auctioneer/rotate`, { 'x-admin-key': ADMIN });
    expect(res.status).toBe(200);
    const fresh = tokenOf(((await res.json()) as { auctioneerLink: string }).auctioneerLink);

    expect((await post(app, path, bearer(fresh))).status).toBe(201);
    expect((await post(app, path, bearer(a.token))).status).toBe(401);
    // The WebSocket join verifies through the same helper and store.
    await expect(verifyFor(deps, a.token, a.id, ['auctioneer'])).rejects.toMatchObject({
      code: 'unauthorized',
    });
    await expect(verifyFor(deps, fresh, a.id, ['auctioneer'])).resolves.toMatchObject({
      kind: 'auctioneer',
    });
  });

  it('lets the operator revoke a jti but not without the key', async () => {
    const { app, deps } = setup();
    const a = await created(app);
    const body = { jti: jtiOf(a.token) };
    const revokePath = `/api/auctions/${a.id}/auctioneer/revoke`;
    expect((await post(app, revokePath, {}, body)).status).toBe(401);
    expect((await post(app, revokePath, { 'x-admin-key': ADMIN }, { jti: 'bad' })).status).toBe(
      400,
    );
    expect((await post(app, revokePath, { 'x-admin-key': ADMIN }, body)).status).toBe(200);
    await expect(verifyFor(deps, a.token, a.id, ['auctioneer'])).rejects.toMatchObject({
      code: 'unauthorized',
    });
    expect((await post(app, `/api/auctions/${a.id}/invites`, bearer(a.token))).status).toBe(401);
  });

  it('refuses rotation without the operator key, even with the auctioneer token (R12-S04)', async () => {
    const { app } = setup();
    const a = await created(app);
    expect((await post(app, `/api/auctions/${a.id}/auctioneer/rotate`, {})).status).toBe(401);
    expect(
      (await post(app, `/api/auctions/${a.id}/auctioneer/rotate`, bearer(a.token))).status,
    ).toBe(401);
    // the leaked link still works and nothing was denied
    expect((await post(app, `/api/auctions/${a.id}/invites`, bearer(a.token))).status).toBe(201);
  });

  it('revoke-all kills every auctioneer token, including ones with unknown jtis (R12-S04)', async () => {
    const { app, deps } = setup();
    const a = await created(app);
    const path = `/api/auctions/${a.id}/auctioneer/revoke-all`;
    expect((await post(app, path, bearer(a.token))).status).toBe(401);
    expect((await post(app, path, { 'x-admin-key': ADMIN })).status).toBe(200);
    expect((await post(app, `/api/auctions/${a.id}/invites`, bearer(a.token))).status).toBe(401);
    // the operator can then issue a working link within the same second
    const res = await post(app, `/api/auctions/${a.id}/auctioneer/rotate`, { 'x-admin-key': ADMIN });
    const fresh = tokenOf(((await res.json()) as { auctioneerLink: string }).auctioneerLink);
    expect((await post(app, `/api/auctions/${a.id}/invites`, bearer(fresh))).status).toBe(201);
    await expect(verifyFor(deps, a.token, a.id, ['auctioneer'])).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });
});
