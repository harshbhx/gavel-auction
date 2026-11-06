import {
  ManualClock,
  SeqIds,
  type AuctionConfig,
  type AuctionId,
  type BidderId,
  type Cents,
} from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { secretSetFromConfig } from '../src/auth/rotation';
import { createHttpApp, type HttpApp, type HttpDeps } from '../src/http/app';
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
  return { app: createHttpApp(deps, [mountAuctions, mountInvites]), deps };
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

describe('re-issuing an invite for a registered bidder (RT4-sec-07)', () => {
  it('gives the same bidderId a fresh single-use invite and refuses strangers', async () => {
    const { app, deps } = setup();
    const a = await created(app);
    const room = await deps.service.room(a.id as AuctionId);
    const bidderId = deps.ids.mint<'BidderId'>() as BidderId;
    await room.registerBidder({ bidderId, name: 'Ada', ceiling: 30000 as Cents, holdRef: 'h1' });

    const path = `/api/auctions/${a.id}/bidders/${bidderId}/invite`;
    const res = await post(app, path, bearer(a.token));
    expect(res.status).toBe(201);
    const issued = (await res.json()) as { bidderId: string; link: string };
    expect(issued.bidderId).toBe(bidderId);

    const join = (invite: string) => post(app, `/api/auctions/${a.id}/join`, {}, { invite });
    const first = await join(tokenOf(issued.link));
    expect(first.status).toBe(200);
    expect(((await first.json()) as { bidderId: string }).bidderId).toBe(bidderId);
    expect((await join(tokenOf(issued.link))).status).not.toBe(200);

    const none = await post(
      app,
      `/api/auctions/${a.id}/bidders/${deps.ids.mint<'BidderId'>()}/invite`,
      bearer(a.token),
    );
    expect(none.status).toBe(404);
    expect((await post(app, path, {})).status).toBe(401);
  });
});
