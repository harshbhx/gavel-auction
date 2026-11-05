import {
  ManualClock,
  SeqIds,
  type AuctionConfig,
  type AuctionId,
  type ConnId,
} from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { secretSetFromConfig } from '../src/auth/rotation';
import { createHttpApp, type HttpApp, type HttpDeps } from '../src/http/app';
import { mountAuctions } from '../src/http/auctions';
import { mountControl } from '../src/http/control';
import { mountInvites } from '../src/http/invites';
import { MemoryTransport } from '../src/room/memory-transport';
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

function setup(): {
  app: HttpApp;
  rooms: Map<string, Promise<Room>>;
  ids: SeqIds;
  clock: ManualClock;
  roomDeps: (id: AuctionId) => RoomDeps;
} {
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
    app: createHttpApp(deps, [mountAuctions, mountInvites, mountControl]),
    rooms,
    ids,
    clock,
    roomDeps,
  };
}

const tokenOf = (link: string): string => link.split('#token=')[1] ?? '';

const post = (app: HttpApp, path: string, headers: Record<string, string>, body: unknown) =>
  app.fetch(
    new Request(`http://h.test${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  );

async function seeded() {
  const { app, rooms, ids, clock, roomDeps } = setup();
  const res = await post(app, '/api/auctions', { 'x-admin-key': ADMIN }, { config });
  const b = (await res.json()) as { auctionId: string; auctioneerLink: string; screenLink: string };
  const auth = { authorization: `Bearer ${tokenOf(b.auctioneerLink)}` };
  const inv = await post(app, `/api/auctions/${b.auctionId}/invites`, auth, {});
  const invite = tokenOf(
    ((await inv.json()) as { invites: Array<{ link: string }> }).invites[0]?.link ?? '',
  );
  const join = await post(app, `/api/auctions/${b.auctionId}/join`, {}, { invite });
  const session = ((await join.json()) as { sessionToken: string }).sessionToken;
  const room = await rooms.get(b.auctionId);
  if (room === undefined) throw new Error('room missing');
  const screen = new MemoryTransport();
  await room.attach({
    id: ids.mint<'ConnId'>() as ConnId,
    role: 'screen',
    sub: 'screen-sub',
    transport: screen,
  });
  return {
    app,
    id: b.auctionId,
    auth,
    session,
    screen,
    room,
    clock,
    rebuild: () => Room.load(b.auctionId as AuctionId, roomDeps(b.auctionId as AuctionId)),
  };
}

describe('control over HTTP (T-RT-078)', () => {
  it('hammers via HTTP and a connected client receives the hammer frame', async () => {
    const s = await seeded();
    const path = `/api/auctions/${s.id}/control`;
    const body = { controlId: 'ctl-1', action: 'hammer', args: { closeNow: 1 } };
    const res = await post(s.app, path, s.auth, body);
    expect(res.status).toBe(200);
    const out = (await res.json()) as { ok: boolean; hammer?: { t: string } };
    expect(out.ok).toBe(true);
    expect(out.hammer?.t).toBe('hammer');
    expect(s.screen.messages('hammer')).toHaveLength(1);

    const again = await post(s.app, path, s.auth, body);
    expect(again.status).toBe(200);
    expect(s.screen.messages('hammer')).toHaveLength(1);
  });

  it('refuses a bidder token, no token, bad bodies and unwired actions', async () => {
    const s = await seeded();
    const path = `/api/auctions/${s.id}/control`;
    const body = { controlId: 'ctl-2', action: 'hammer', args: { closeNow: 1 } };
    expect((await post(s.app, path, { authorization: `Bearer ${s.session}` }, body)).status).toBe(
      403,
    );
    expect((await post(s.app, path, {}, body)).status).toBe(401);
    expect((await post(s.app, path, s.auth, { controlId: '', action: 'hammer' })).status).toBe(400);
    expect((await post(s.app, path, s.auth, { controlId: 'c', action: 'boom' })).status).toBe(400);
    expect((await post(s.app, path, s.auth, { controlId: 'c3', action: 'extend' })).status).toBe(
      400,
    );
    expect(s.screen.messages('hammer')).toHaveLength(0);
  });
});

describe('clock controls over HTTP (R-RT-048, R-RT-049)', () => {
  it('pauses, resumes and extends the lot, idempotent by controlId', async () => {
    const s = await seeded();
    const path = `/api/auctions/${s.id}/control`;
    const endTs = (): number => s.room.activeEngine?.view().endTs ?? 0;
    const before = endTs();

    // `open` changes nothing on an open lot, so it is refused and not audited.
    expect((await post(s.app, path, s.auth, { controlId: 'o1', action: 'open' })).status).toBe(409);

    const pause = { controlId: 'p1', action: 'pause' };
    expect((await post(s.app, path, s.auth, pause)).status).toBe(200);
    expect((await post(s.app, path, s.auth, pause)).status).toBe(200);
    // A second pause with a new id is refused: the clock is already frozen.
    expect((await post(s.app, path, s.auth, { controlId: 'p2', action: 'pause' })).status).toBe(
      409,
    );

    s.clock.advance(60_000);
    const resume = { controlId: 'r1', action: 'resume' };
    expect((await post(s.app, path, s.auth, resume)).status).toBe(200);
    expect((await post(s.app, path, s.auth, resume)).status).toBe(200);
    expect(endTs()).toBe(before + 60_000);

    const extend = { controlId: 'e1', action: 'extend', args: { extraMs: 30_000 } };
    expect((await post(s.app, path, s.auth, extend)).status).toBe(200);
    expect((await post(s.app, path, s.auth, extend)).status).toBe(200);
    expect(endTs()).toBe(before + 90_000);
  });

  it('refuses a bidder token and a bad extend', async () => {
    const s = await seeded();
    const path = `/api/auctions/${s.id}/control`;
    const bearer = { authorization: `Bearer ${s.session}` };
    for (const action of ['open', 'pause', 'resume', 'extend']) {
      const body = { controlId: `x-${action}`, action, args: { extraMs: 1000 } };
      expect((await post(s.app, path, bearer, body)).status).toBe(403);
    }
    const bad = { controlId: 'e2', action: 'extend', args: { extraMs: 0 } };
    expect((await post(s.app, path, s.auth, bad)).status).toBe(400);
  });

  it('keeps a pause across a room rebuild from the log', async () => {
    const s = await seeded();
    const path = `/api/auctions/${s.id}/control`;
    await post(s.app, path, s.auth, { controlId: 'p1', action: 'pause' });
    const rebuilt = await s.rebuild();
    const engine = rebuilt.activeEngine as LedgerEngine | undefined;
    expect(engine?.paused).toBe(true);
  });
});
