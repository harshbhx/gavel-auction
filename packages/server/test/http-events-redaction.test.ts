import {
  ManualClock,
  SeqIds,
  type AuctionConfig,
  type AuctionId,
  type BidId,
  type BidderId,
  type Cents,
  type EpochMs,
  type MsgId,
  type RoomEvent,
} from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { secretSetFromConfig } from '../src/auth/rotation';
import { createHttpApp, type HttpApp, type HttpDeps } from '../src/http/app';
import { mountAuctions } from '../src/http/auctions';
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
  return { clock, app: createHttpApp(deps, [mountAuctions, mountRead]), deps };
}

const tokenOf = (link: string): string => link.split('#token=')[1] ?? '';
const bearer = (t: string): Record<string, string> => ({ authorization: `Bearer ${t}` });

const bidderId = '01J9ZQ3A0B2C4D6F8H0J2K4M60' as BidderId;
const audit = (seq: number, extra: Record<string, unknown>) => ({
  bidId: '01J9ZQ3A0B2C4D6F8H0J2K4M61' as BidId,
  bidderId,
  source: 'voice' as const,
  outcome: 'accepted' as const,
  serverTs: START as EpochMs,
  seq,
  ...extra,
});

describe('events route redaction (R12-S07)', () => {
  it('gives the auctioneer no voice transcript, hold id or auctioneer sub', async () => {
    const { app, deps } = setup();
    const res = await app.fetch(
      new Request('http://h.test/api/auctions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-admin-key': ADMIN },
        body: JSON.stringify({ config }),
      }),
    );
    const b = (await res.json()) as {
      auctionId: string;
      auctioneerLink: string;
      screenLink: string;
    };
    const id = b.auctionId as AuctionId;
    const base = { auctionId: id, ts: START as EpochMs };
    const extra: RoomEvent[] = [
      {
        ...base,
        seq: 2,
        type: 'bidder_registered',
        bidderId,
        paddle: 1,
        name: 'Ada',
        ceiling: 30000 as Cents,
        holdRef: 'hold-secret',
      },
      {
        ...base,
        seq: 3,
        type: 'confirm_requested',
        confirmId: 'c1',
        bidderId,
        mid: '01J9ZQ3A0B2C4D6F8H0J2K4M62' as MsgId,
        amount: 25000 as Cents,
        expiresAt: (START + 9000) as EpochMs,
        audit: audit(3, { transcript: 'two hundred fifty', parsedAmount: 25000, audioTsMs: 5 }),
      },
      {
        ...base,
        seq: 4,
        type: 'confirm_resolved',
        confirmId: 'c1',
        outcome: 'accepted',
        audit: audit(4, { transcript: 'two hundred fifty', parsedAmount: 25000, audioTsMs: 5 }),
      },
    ];
    await deps.store.appendEvents(id, await deps.store.lastSeq(id), extra);
    for (const link of [b.auctioneerLink, b.screenLink]) {
      const r = await app.fetch(
        new Request(`http://h.test/api/auctions/${id}/events?limit=50`, {
          headers: bearer(tokenOf(link)),
        }),
      );
      expect(r.status).toBe(200);
      const text = await r.text();
      expect(text).not.toContain('two hundred fifty');
      expect(text).not.toContain('hold-secret');
      expect(text).not.toContain('auctioneerSub');
      expect(text).not.toContain('"ceiling"');
      expect(text).not.toContain('25000');
    }
  });
});
