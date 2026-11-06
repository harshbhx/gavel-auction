import {
  ManualClock,
  SeqIds,
  type AuctionConfig,
  type AuctionId,
  type EpochMs,
  type Jti,
} from '@gavel/shared';
import { createGateway } from '../src/host/gateway';
import { BoundedConnection } from '../src/transport/connections';
import { describe, expect, it } from 'vitest';
import { secretSetFromConfig } from '../src/auth/rotation';
import { createHttpApp, type HttpApp, type HttpDeps } from '../src/http/app';
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

function setup(): { app: HttpApp; deps: HttpDeps; clock: ManualClock } {
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
  return {
    app: createHttpApp(deps, [mountAuctions, mountInvites, mountAuctioneerToken]),
    deps,
    clock,
  };
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

const jtiOf = (token: string): string =>
  (
    JSON.parse(atob((token.split('.')[0] ?? '').replace(/-/g, '+').replace(/_/g, '/'))) as {
      jti: string;
    }
  ).jti;

async function joined() {
  const s = setup();
  const res = await post(s.app, '/api/auctions', { 'x-admin-key': ADMIN }, { config });
  const b = (await res.json()) as { auctionId: string; auctioneerLink: string };
  const token = tokenOf(b.auctioneerLink);
  const closes: { code: number; reason: string }[] = [];
  const conn = new BoundedConnection({
    clock: s.clock,
    sink: {
      write: (_t, done) => done(),
      close: (code, reason) => closes.push({ code, reason }),
    },
  });
  const handlers = createGateway({
    service: s.deps.service,
    store: s.deps.store,
    clock: s.clock,
    ids: s.deps.ids,
    secrets: s.deps.secrets,
    limiter: { checkFrame: () => ({ ok: true }) } as never,
  })(conn);
  await handlers.onJoin({ v: 1, t: 'join', token, auctionId: b.auctionId } as never);
  expect(closes).toEqual([]);
  const bid = JSON.stringify({ v: 1, t: 'bid', mid: 'm1', bidderId: b.auctionId, amount: 10500 });
  return { ...s, id: b.auctionId, token, closes, handlers, conn, bid };
}

describe('open sockets follow the token (HRD-47)', () => {
  it('closes the auctioneer socket with 4401 when the token is rotated', async () => {
    const s = await joined();
    const res = await post(s.app, `/api/auctions/${s.id}/auctioneer/rotate`, {
      'x-admin-key': ADMIN,
    });
    expect(res.status).toBe(200);
    expect(s.closes).toEqual([{ code: 4401, reason: 'unauthorized' }]);
  });

  it('closes the socket on revoke-all and on revoke of its jti', async () => {
    const all = await joined();
    await post(all.app, `/api/auctions/${all.id}/auctioneer/revoke-all`, { 'x-admin-key': ADMIN });
    expect(all.closes).toEqual([{ code: 4401, reason: 'unauthorized' }]);

    const one = await joined();
    await post(
      one.app,
      `/api/auctions/${one.id}/auctioneer/revoke`,
      { 'x-admin-key': ADMIN },
      { jti: jtiOf(one.token) },
    );
    expect(one.closes).toEqual([{ code: 4401, reason: 'unauthorized' }]);
  });

  it('closes the socket when the token expires', async () => {
    const s = await joined();
    s.clock.advanceTo(START + 12 * 3600 * 1000 + 1000);
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 5));
    expect(s.closes).toEqual([{ code: 4401, reason: 'unauthorized' }]);
  });

  it('refuses a privileged frame once the jti is denied, even without a sweep', async () => {
    const s = await joined();
    await s.deps.store.denyJti(jtiOf(s.token) as Jti, (START + 1e9) as EpochMs);
    await s.handlers.onFrame(s.bid);
    expect(s.closes).toEqual([{ code: 4401, reason: 'unauthorized' }]);
  });
});
