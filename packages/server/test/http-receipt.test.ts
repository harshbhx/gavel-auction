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
import { TOKEN_TTL_S, signToken, verifyToken, type TokenPayload } from '../src/auth/token';
import { createHttpApp, type HttpApp, type HttpDeps } from '../src/http/app';
import { mountAuctions } from '../src/http/auctions';
import { mountInvites } from '../src/http/invites';
import { mountRead } from '../src/http/read';
import { mountReceipt } from '../src/http/receipt';
import { Room, type RoomDeps } from '../src/room/room';
import { LedgerEngine } from '../src/runtime/ledger-engine';
import { MemoryStore } from '../src/store/memory-store';

const START = 1_789_000_000_000;
const ADMIN = 'fake-admin-key';
const SECRET = 'fake-secret-fake-secret-fake-0000';

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

function setup(): { app: HttpApp; clock: ManualClock; rooms: Map<string, Promise<Room>> } {
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
    secrets: secretSetFromConfig({ TOKEN_SECRET: SECRET }),
    adminKey: ADMIN,
    publicUrl: 'https://gavel.example.test',
    corsOrigins: [],
  };
  const mounts = [mountAuctions, mountInvites, mountRead, mountReceipt];
  return { app: createHttpApp(deps, mounts), clock, rooms };
}

const tokenOf = (link: string): string => link.split('#token=')[1] ?? '';
const bearer = (t: string): Record<string, string> => ({ authorization: `Bearer ${t}` });
const get = (app: HttpApp, path: string, token: string | null) =>
  app.fetch(new Request(`http://h.test${path}`, { headers: token === null ? {} : bearer(token) }));
const post = (app: HttpApp, path: string, token: string) =>
  app.fetch(
    new Request(`http://h.test${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...bearer(token) },
      body: '{}',
    }),
  );

async function seeded() {
  const { app, clock, rooms } = setup();
  const res = await app.fetch(
    new Request('http://h.test/api/auctions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-key': ADMIN },
      body: JSON.stringify({ title: 'Gala lot', config }),
    }),
  );
  const b = (await res.json()) as { auctionId: string; auctioneerLink: string; screenLink: string };
  const auctioneer = tokenOf(b.auctioneerLink);
  const room = await rooms.get(b.auctionId);
  const inv = await post(app, `/api/auctions/${b.auctionId}/invites`, auctioneer);
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
  for (let i = 0; i < 4; i++) {
    await room?.registerBidder({
      bidderId: (i === 0
        ? j.bidderId
        : `01J9ZQ3A0B2C4D6F8H0J2K4M${String(i).padStart(2, '6')}`) as BidderId,
      name: `Bidder ${i}`,
      ceiling: 30000 as Cents,
      holdRef: `hold-${i}`,
    });
  }
  const link = await post(app, `/api/auctions/${b.auctionId}/receipt-link`, j.sessionToken);
  const minted = (await link.json()) as { link: string; expiresAt: number };
  return {
    app,
    clock,
    id: b.auctionId,
    auctioneer,
    screen: tokenOf(b.screenLink),
    session: j.sessionToken,
    bidderId: j.bidderId,
    receipt: tokenOf(minted.link),
    minted,
  };
}

describe('receipt link (UX-05)', () => {
  it('mints a link with a receipt token that expires with the session lifetime', async () => {
    const s = await seeded();
    expect(s.minted.link.startsWith(`https://gavel.example.test/r/${s.id}/receipt#token=`)).toBe(
      true,
    );
    expect(s.minted.expiresAt).toBe(START + TOKEN_TTL_S.receipt * 1000);
    expect(TOKEN_TTL_S.receipt).toBe(TOKEN_TTL_S.session);
  });

  it('shows only the holder: own name and paddle, no other bidder, no ceiling', async () => {
    const s = await seeded();
    const res = await get(s.app, `/api/auctions/${s.id}/receipt`, s.receipt);
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text) as {
      snapshot: { roster: Array<{ bidderId: string; name: string }>; lotTitle?: string };
    };
    expect(body.snapshot.roster).toHaveLength(1);
    expect(body.snapshot.roster[0]?.bidderId).toBe(s.bidderId);
    expect(body.snapshot.roster[0]?.name).toBe('Bidder 0');
    expect(body.snapshot.lotTitle).toBe('Gala lot');
    expect(text).not.toMatch(/Bidder [123]|joinCode|holdRef|"sub"|"you"/);
    // The holder's own ceiling stays private: no key at any depth is `ceiling` or `ceilingCents`.
    // `config.ceilingPresets` is the public preset list, not a holder's amount, so it may stay.
    const keys: string[] = [];
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v !== null && typeof v === 'object') {
        for (const [k, child] of Object.entries(v)) {
          keys.push(k);
          walk(child);
        }
      }
    };
    walk(body);
    expect(keys.length).toBeGreaterThan(5);
    expect(keys.filter((k) => /^ceiling(cents)?$/i.test(k))).toEqual([]);
  });

  it('only a session may mint, and only for itself', async () => {
    const s = await seeded();
    for (const token of [s.auctioneer, s.screen, s.receipt]) {
      const res = await post(s.app, `/api/auctions/${s.id}/receipt-link`, token);
      expect(res.status).toBe(401);
    }
    expect((await get(s.app, `/api/auctions/${s.id}/receipt`, s.session)).status).toBe(401);
    expect((await get(s.app, `/api/auctions/${s.id}/receipt`, s.screen)).status).toBe(401);
    expect((await get(s.app, `/api/auctions/${s.id}/receipt`, null)).status).toBe(401);
  });

  it('cannot call any other route', async () => {
    const s = await seeded();
    const t = s.receipt;
    const calls = [
      get(s.app, `/api/auctions/${s.id}/snapshot`, t),
      get(s.app, `/api/auctions/${s.id}/events`, t),
      post(s.app, `/api/auctions/${s.id}/invites`, t),
      post(s.app, `/api/auctions/${s.id}/control`, t),
      post(s.app, `/api/auctions/${s.id}/receipt-link`, t),
    ];
    for (const res of await Promise.all(calls)) expect([401, 403, 404]).toContain(res.status);
    const snapshot = await get(s.app, `/api/auctions/${s.id}/snapshot`, t);
    expect(snapshot.status).toBe(401);
  });

  it('is refused after it expires', async () => {
    const s = await seeded();
    s.clock.advanceTo(START + TOKEN_TTL_S.receipt * 1000 - 1000);
    expect((await get(s.app, `/api/auctions/${s.id}/receipt`, s.receipt)).status).toBe(200);
    s.clock.advanceTo(START + TOKEN_TTL_S.receipt * 1000 + 1000);
    expect((await get(s.app, `/api/auctions/${s.id}/receipt`, s.receipt)).status).toBe(401);
  });

  it('is refused when altered, re-signed with another kind or aimed at another auction', async () => {
    const s = await seeded();
    const [body = '', sig = ''] = s.receipt.split('.');
    const flip = (x: string): string => `${x.slice(0, -2)}${x.endsWith('AA') ? 'BB' : 'AA'}`;
    for (const bad of [`${flip(body)}.${sig}`, `${body}.${flip(sig)}`, body, `${sig}.${body}`]) {
      expect((await get(s.app, `/api/auctions/${s.id}/receipt`, bad)).status).toBe(401);
    }
    const other = '01J9ZQ3A0B2C4D6F8H0J2K4MZZ';
    expect((await get(s.app, `/api/auctions/${other}/receipt`, s.receipt)).status).toBe(401);
    const payload = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/'))) as TokenPayload;
    const forged = await signToken(
      { ...payload, kind: 'session', bidderId: payload.sub },
      'x'.repeat(40),
    );
    expect((await get(s.app, `/api/auctions/${s.id}/receipt`, forged)).status).toBe(401);
  });
});

describe('receipt token payload', () => {
  const NOW_S = Math.floor(START / 1000);
  const ID = '01J9ZQ3A0B2C4D6F8H0J2K4M60';
  const base: TokenPayload = {
    kind: 'receipt',
    aud: ID,
    sub: ID,
    jti: '01J9ZQ3A0B2C4D6F8H0J2K4M61',
    iat: NOW_S,
    exp: NOW_S + TOKEN_TTL_S.receipt,
  };
  const opts = {
    aud: ID,
    kinds: ['receipt'] as const,
    nowMs: START,
    jtis: { isRevoked: async () => false, consume: async () => true },
  };

  it('accepts the plain shape', async () => {
    const r = await verifyToken(await signToken(base, SECRET), SECRET, opts);
    expect(r.ok).toBe(true);
  });

  it('refuses a bidderId, a non-id subject and a longer lifetime', async () => {
    const variants: TokenPayload[] = [
      { ...base, bidderId: ID },
      { ...base, sub: 'someone' },
      { ...base, exp: NOW_S + TOKEN_TTL_S.receipt + 1 },
    ];
    for (const v of variants) {
      const r = await verifyToken(await signToken(v, SECRET), SECRET, opts);
      expect(r.ok).toBe(false);
    }
  });

  it('is not accepted where a session is required', async () => {
    const r = await verifyToken(await signToken(base, SECRET), SECRET, {
      ...opts,
      kinds: ['session'],
    });
    expect(r.ok).toBe(false);
  });
});
