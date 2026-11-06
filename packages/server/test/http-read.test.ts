import {
  decodeServerMsg,
  ManualClock,
  RoomEventSchema,
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
import { mountRead } from '../src/http/read';
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

function setup(): { app: HttpApp; rooms: Map<string, Promise<Room>> } {
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
  return { app: createHttpApp(deps, [mountAuctions, mountInvites, mountRead]), rooms };
}

const tokenOf = (link: string): string => link.split('#token=')[1] ?? '';
const bearer = (t: string): Record<string, string> => ({ authorization: `Bearer ${t}` });
const get = (app: HttpApp, path: string, token: string | null) =>
  app.fetch(new Request(`http://h.test${path}`, { headers: token === null ? {} : bearer(token) }));

async function seeded(): Promise<{
  app: HttpApp;
  id: string;
  auctioneer: string;
  screen: string;
  session: string;
}> {
  const { app, rooms } = setup();
  const res = await app.fetch(
    new Request('http://h.test/api/auctions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-key': ADMIN },
      body: JSON.stringify({ config }),
    }),
  );
  const b = (await res.json()) as { auctionId: string; auctioneerLink: string; screenLink: string };
  const auctioneer = tokenOf(b.auctioneerLink);
  const room = await rooms.get(b.auctionId);
  const inv = await app.fetch(
    new Request(`http://h.test/api/auctions/${b.auctionId}/invites`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...bearer(auctioneer) },
      body: '{}',
    }),
  );
  const invite = tokenOf(
    ((await inv.json()) as { invites: Array<{ link: string }> }).invites[0]?.link ?? '',
  );
  const join = await app.fetch(
    new Request(`http://h.test/api/auctions/${b.auctionId}/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ invite }),
    }),
  );
  const j = (await join.json()) as { sessionToken: string; bidderId: string };
  for (let i = 0; i < 12; i++) {
    await room?.registerBidder({
      bidderId: (i === 0
        ? j.bidderId
        : `01J9ZQ3A0B2C4D6F8H0J2K4M${String(i).padStart(2, '6')}`) as BidderId,
      name: `Bidder ${i}`,
      ceiling: 30000 as Cents,
      holdRef: `hold-${i}`,
    });
  }
  return {
    app,
    id: b.auctionId,
    auctioneer,
    screen: tokenOf(b.screenLink),
    session: j.sessionToken,
  };
}

describe('snapshot lot title and join code (HRD-71)', () => {
  it('carries the title and join code to the screen without private data', async () => {
    const { app } = setup();
    const res = await app.fetch(
      new Request('http://h.test/api/auctions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-admin-key': ADMIN },
        body: JSON.stringify({ title: 'Gala lot', config }),
      }),
    );
    const b = (await res.json()) as { auctionId: string; screenLink: string; joinCode: string };
    const snap = await get(app, `/api/auctions/${b.auctionId}/snapshot`, tokenOf(b.screenLink));
    const text = await snap.text();
    const decoded = decodeServerMsg(text);
    expect(decoded.ok).toBe(true);
    const out = JSON.parse(text) as { snapshot: Record<string, unknown> };
    expect(out.snapshot.lotTitle).toBe('Gala lot');
    expect(out.snapshot.joinCode).toBe(b.joinCode);
    expect(out.snapshot.registrationClosed).toBeUndefined();
    expect(text).not.toMatch(/ceiling|holdRef|"sub"/);
  });
});

describe('snapshot and events (T-RT-076)', () => {
  it('returns a schema-valid snapshot for each role, with the ceiling only for the owner', async () => {
    const s = await seeded();
    for (const [token, ceiling] of [
      [s.session, true],
      [s.auctioneer, false],
      [s.screen, false],
    ] as const) {
      const res = await get(s.app, `/api/auctions/${s.id}/snapshot`, token);
      expect(res.status).toBe(200);
      const text = await res.text();
      const decoded = decodeServerMsg(text);
      expect(decoded.ok).toBe(true);
      expect(text.includes('"ceiling"')).toBe(ceiling);
    }
    expect((await get(s.app, `/api/auctions/${s.id}/snapshot`, null)).status).toBe(401);
  });

  it('pages events with after and limit and keeps ceilings out', async () => {
    const s = await seeded();
    const res = await get(s.app, `/api/auctions/${s.id}/events?after=5&limit=4`, s.auctioneer);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: unknown[]; next: number };
    expect(body.events).toHaveLength(4);
    expect(body.next).toBe(9);
    for (const e of body.events) {
      const withCeiling =
        (e as { type: string }).type === 'bidder_registered'
          ? { ...(e as object), ceiling: 0, name: 'n', holdRef: 'h' }
          : e;
      const parsed = RoomEventSchema.safeParse(withCeiling);
      expect(parsed.success).toBe(true);
      expect(JSON.stringify(e)).not.toContain('ceiling');
    }
    const screen = await get(s.app, `/api/auctions/${s.id}/events?after=0`, s.screen);
    expect(screen.status).toBe(200);
  });

  it('refuses bidders on events and rejects bad paging', async () => {
    const s = await seeded();
    expect((await get(s.app, `/api/auctions/${s.id}/events`, s.session)).status).toBe(401);
    expect((await get(s.app, `/api/auctions/${s.id}/events?limit=0`, s.auctioneer)).status).toBe(
      400,
    );
    expect((await get(s.app, `/api/auctions/${s.id}/events?after=-1`, s.auctioneer)).status).toBe(
      400,
    );
  });
});
