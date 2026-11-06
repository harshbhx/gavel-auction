import type { IncomingMessage, ServerResponse } from 'node:http';
import { ManualClock, UlidMinter, type AuctionConfig, type AuctionId } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { createDemoHandler, type DemoDeps } from '../src/http/demo';
import { ADMIN_KEY_HEADER } from '../src/http/ops';

const KEY = 'test-admin-key-placeholder-0000';

async function call(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  method: string,
  url: string,
  headers: Record<string, string>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const out = { status: 0, text: '' };
  const req = { method, url, headers } as unknown as IncomingMessage;
  const res = {
    setHeader() {},
    writeHead(status: number) {
      out.status = status;
    },
    end(text: string) {
      out.text = text;
    },
  } as unknown as ServerResponse;
  await handler(req, res);
  return { status: out.status, body: JSON.parse(out.text) as Record<string, unknown> };
}

function setup(over: Partial<DemoDeps> = {}) {
  const created: string[] = [];
  const registered: Array<{ auctionId: string; name: string; holdId: string }> = [];
  const retired: string[] = [];
  const deps: DemoDeps = {
    enabled: true,
    production: false,
    adminKey: KEY,
    ids: new UlidMinter(new ManualClock(1_789_000_000_000)),
    service: {
      createAuction: async (id: AuctionId) => {
        created.push(id);
        return undefined as never;
      },
      registerBidder: async (i) => {
        registered.push({ auctionId: i.auctionId, name: i.name, holdId: i.holdId });
      },
    },
    config: {} as AuctionConfig,
    auctioneerSub: 'demo-auctioneer',
    holdFor: async (bidderId) => `fake-hold-${bidderId}`,
    retire: async (id) => {
      retired.push(id);
    },
    maxRooms: 20,
    ...over,
  };
  return { handler: createDemoHandler(deps), created, registered, retired };
}

const admin = { [ADMIN_KEY_HEADER]: KEY };

describe('demo routes (T-RT-079)', () => {
  it('is 404 when the flag is off, even with the admin key', async () => {
    const { handler, created } = setup({ enabled: false });
    expect((await call(handler, 'POST', '/api/demo/reset', admin)).status).toBe(404);
    expect((await call(handler, 'POST', '/api/demo/seed', admin)).status).toBe(404);
    expect(created).toEqual([]);
  });

  it('is 404 under production config even when enabled', async () => {
    const { handler, created } = setup({ production: true });
    expect((await call(handler, 'POST', '/api/demo/seed', admin)).status).toBe(404);
    expect(created).toEqual([]);
  });

  it('needs the admin key and POST', async () => {
    const { handler } = setup();
    expect((await call(handler, 'POST', '/api/demo/reset', {})).status).toBe(401);
    expect((await call(handler, 'GET', '/api/demo/reset', admin)).status).toBe(405);
    expect((await call(handler, 'POST', '/api/demo/other', admin)).status).toBe(404);
  });

  it('reset gives an empty room and retires the previous one', async () => {
    const { handler, created, registered, retired } = setup();
    const first = await call(handler, 'POST', '/api/demo/reset', admin);
    expect(first).toMatchObject({ status: 200, body: { bidders: 0 } });
    await call(handler, 'POST', '/api/demo/reset', admin);
    expect(created).toHaveLength(2);
    expect(retired).toEqual([created[0]]);
    expect(registered).toEqual([]);
  });

  it('seed creates the scripted auction with 3 bidders', async () => {
    const { handler, created, registered } = setup();
    const r = await call(handler, 'POST', '/api/demo/seed', admin);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ auctionId: created[0], bidders: 3 });
    expect(registered).toHaveLength(3);
    expect(registered.every((b) => b.auctionId === created[0])).toBe(true);
    expect(registered.map((b) => b.name)).toEqual([
      'Demo Bidder 1',
      'Demo Bidder 2',
      'Demo Bidder 3',
    ]);
  });

  it('answers 500 without leaking details when a step fails', async () => {
    const { handler } = setup({
      holdFor: () => Promise.reject(new Error('secret detail')),
    });
    const r = await call(handler, 'POST', '/api/demo/seed', admin);
    expect(r).toEqual({ status: 500, body: { error: 'demo_failed' } });
  });

  it('rooms makes a seeded room each call and never retires an earlier one', async () => {
    const { handler, created, registered, retired } = setup();
    const a = await call(handler, 'POST', '/api/demo/rooms', admin);
    const b = await call(handler, 'POST', '/api/demo/rooms', admin);
    expect(a).toMatchObject({ status: 200, body: { auctionId: created[0], bidders: 3 } });
    expect(b.body.auctionId).toBe(created[1]);
    expect(created[0]).not.toBe(created[1]);
    expect(registered).toHaveLength(6);
    expect(retired).toEqual([]);
  });

  it('rooms is gated like the other demo routes', async () => {
    const off = setup({ enabled: false });
    expect((await call(off.handler, 'POST', '/api/demo/rooms', admin)).status).toBe(404);
    const prod = setup({ production: true });
    expect((await call(prod.handler, 'POST', '/api/demo/rooms', admin)).status).toBe(404);
    const open = setup();
    expect((await call(open.handler, 'POST', '/api/demo/rooms', {})).status).toBe(401);
    expect((await call(open.handler, 'GET', '/api/demo/rooms', admin)).status).toBe(405);
    expect(open.created).toEqual([]);
  });

  it('passes the room id to the hold source and accepts a per-room config function', async () => {
    const seen: string[] = [];
    const { handler, created } = setup({
      config: () => ({}) as AuctionConfig,
      holdFor: async (bidderId, _ceiling, auctionId) => {
        seen.push(auctionId);
        return `h-${bidderId}`;
      },
    });
    await call(handler, 'POST', '/api/demo/rooms', admin);
    expect(seen).toEqual([created[0], created[0], created[0]]);
  });

  it('rooms answers 429 demo_room_cap once DEMO_MAX_ROOMS live rooms exist', async () => {
    const { handler, created, registered } = setup({ maxRooms: 2 });
    const a = await call(handler, 'POST', '/api/demo/rooms', admin);
    const b = await call(handler, 'POST', '/api/demo/rooms', admin);
    expect(a).toMatchObject({ status: 200, body: { auctionId: created[0], bidders: 3 } });
    expect(b).toMatchObject({ status: 200, body: { auctionId: created[1], bidders: 3 } });
    const c = await call(handler, 'POST', '/api/demo/rooms', admin);
    expect(c).toEqual({ status: 429, body: { error: 'demo_room_cap' } });
    expect(created).toHaveLength(2);
    expect(registered).toHaveLength(6);
  });
});
