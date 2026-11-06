import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryLedgerStore, evolveAll, type Ulid } from '@gavel/engine';
import {
  HoldService,
  PayPalError,
  MemoryHoldStore,
  MemoryKillStateStore,
  PersistentKillSwitch,
  MemoryJournalStore,
  MemoryWebhookEventStore,
  PayPalGateway,
  TokenManager,
  Transport,
  WebhookVerifier,
  type HoldRecord,
  type Journal,
  type PaymentAudit,
  type ReconcileReport,
  type VoidAllOutcome,
} from '@gavel/payments';
import { DEFAULT_FAKE_WEBHOOK_ID, FakePayPalServer } from '@gavel/payments/fake';
import {
  ManualClock,
  SeqIds,
  type AuctionConfig,
  type AuctionId,
  type BidderId,
  type ConnId,
  type EpochMs,
  type RoomEvent,
} from '@gavel/shared';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryTransport } from '../../src/room/memory-transport';
import { DEFAULT_CAPS } from '../../src/limits/caps';
import type { Connection, Room } from '../../src/room/room';
import { voidSpareHolds, type SpareVoidDeps } from '../../src/runtime/void-phase';
import { MemoryStore } from '../../src/store/memory-store';
import { FileLedgerStore } from '../../src/store/file-ledger-store';
import { FileRoomStore } from '../../src/store/file-room-store';
import { RoomJournalStore } from '../../src/store/room-journal-store';
import {
  createAuctionService,
  type AuctionService,
  type AuctionServiceDeps,
} from '../../src/runtime/auction-service';

const START = 1_789_000_000_000;
const noSleep = async (): Promise<void> => undefined;

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
} as unknown as AuctionConfig;

const open: PaypalHandle[] = [];

interface PaypalHandle {
  stop(): Promise<void>;
}

afterEach(async () => {
  for (const p of open.splice(0)) await p.stop();
});

/** Everything that outlives a restart of the service. */
async function makeRig(core: { autoReleaseRemainder?: boolean } = {}) {
  const paypal = new FakePayPalServer({ timers: { sleep: noSleep }, core });
  await paypal.start();
  open.push(paypal);
  const auth = new TokenManager({
    transport: new Transport({ sleep: noSleep }),
    baseUrl: paypal.url,
    clientId: 'fake-client',
    clientSecret: 'fake-secret-value',
  });
  const clock = new ManualClock(START);
  const ids = new SeqIds();
  const audits: PaymentAudit[] = [];
  const audit = {
    append: async (e: PaymentAudit): Promise<void> => {
      audits.push(e);
    },
  };
  const payClock = { nowMs: (): number => clock.now() };
  const gateway = new PayPalGateway({ auth, fake: true, clock: payClock });
  let holdCounter = 0;
  const holdService = (holds: MemoryHoldStore) =>
    new HoldService({
      gateway,
      holds,
      audit,
      clock: payClock,
      maxCeilingCents: 100_000,
      newId: () => `HOLD-${(holdCounter += 1)}`,
    });
  const stores = {
    store: new MemoryStore(() => clock.now()),
    ledger: new InMemoryLedgerStore(),
    journals: new MemoryJournalStore(),
    holds: new MemoryHoldStore(),
    webhookEvents: new MemoryWebhookEventStore(),
  };
  const verifier = new WebhookVerifier({ auth, webhookId: DEFAULT_FAKE_WEBHOOK_ID, fake: true });
  const holdsApi = holdService(stores.holds);
  const killSwitch = new PersistentKillSwitch({
    store: new MemoryKillStateStore(),
    audit,
    clock: payClock,
  });
  const service = (extra: Partial<AuctionServiceDeps> = {}): AuctionService =>
    createAuctionService({
      ...stores,
      clock,
      ids,
      audit,
      gateway,
      verifier,
      killSwitch,
      ...extra,
    });
  return { paypal, clock, ids, stores, audits, holdsApi, killSwitch, service, gateway };
}

type Rig = Awaited<ReturnType<typeof makeRig>>;

/** What `voidSpareHolds` needs, with the rig's audit rows and clock. */
function spareDeps(rig: Rig): SpareVoidDeps {
  return {
    audit: { append: async (e) => void rig.audits.push(e) },
    clock: { nowMs: () => rig.clock.now() },
    gateway: rig.gateway,
    holds: rig.stores.holds,
  };
}

interface Bidder {
  id: BidderId;
  holdId: string;
  authId: string;
  conn: Connection;
  transport: MemoryTransport;
}

async function connect(
  rig: Rig,
  room: Room,
  role: Connection['role'],
  bidderId?: BidderId,
): Promise<{ conn: Connection; transport: MemoryTransport }> {
  const transport = new MemoryTransport();
  const conn: Connection = {
    id: rig.ids.mint<'ConnId'>() as ConnId,
    role,
    sub: bidderId ?? `${role}-sub`,
    transport,
    ...(bidderId ? { bidderId } : {}),
  };
  await room.attach(conn);
  return { conn, transport };
}

async function enroll(
  rig: Rig,
  service: AuctionService,
  room: Room,
  auctionId: AuctionId,
  name: string,
  ceilingCents: number,
): Promise<Bidder> {
  const id = rig.ids.mint<'BidderId'>();
  const created = await rig.holdsApi.createHoldOrder({
    auctionId,
    bidderId: id,
    ceilingCents,
    presetsCents: config.ceilingPresets,
  });
  rig.paypal.core.approveOrder(created.orderId);
  await rig.holdsApi.completeApproval({ holdId: created.holdId, orderId: created.orderId });
  await service.registerBidder({ auctionId, bidderId: id, name, holdId: created.holdId });
  const hold = await rig.stores.holds.get(created.holdId);
  const { conn, transport } = await connect(rig, room, 'bidder', id);
  return { id, holdId: created.holdId, authId: hold?.authId ?? '', conn, transport };
}

const bid = (rig: Rig, amount: number) => ({
  v: 1 as const,
  t: 'bid' as const,
  mid: rig.ids.mint<'MsgId'>(),
  amount,
  source: 'qr' as const,
});

interface Run {
  auctionId: AuctionId;
  room: Room;
  a: Bidder;
  b: Bidder;
  c: Bidder;
  screen: MemoryTransport;
}

/** A, B and C bid; A leads at 13000. The auctioneer hammers early. */
async function runToHammer(
  rig: Rig,
  service: AuctionService,
  beforeHammer?: (bidders: Bidder[]) => void,
): Promise<Run> {
  const auctionId = rig.ids.mint<'AuctionId'>();
  const room = await service.createAuction(auctionId, config, 'auctioneer-sub');
  const a = await enroll(rig, service, room, auctionId, 'Ada', 50000);
  const b = await enroll(rig, service, room, auctionId, 'Bo', 30000);
  const c = await enroll(rig, service, room, auctionId, 'Cy', 30000);
  const screen = await connect(rig, room, 'screen');
  const boss = await connect(rig, room, 'auctioneer');
  await room.submitBid(a.conn, bid(rig, 10000));
  await room.submitBid(b.conn, bid(rig, 10500));
  await room.submitBid(a.conn, bid(rig, 12000));
  await room.submitBid(c.conn, bid(rig, 12500));
  await room.submitBid(a.conn, bid(rig, 13000));
  beforeHammer?.([a, b, c]);
  await room.control(boss.conn, { controlId: 'hammer-1', action: 'hammer', args: { closeNow: 1 } });
  return { auctionId, room, a, b, c, screen: screen.transport };
}

async function journalOf(rig: Rig, auctionId: AuctionId): Promise<Journal> {
  const j = await rig.stores.journals.load(auctionId);
  if (j === null) throw new Error('no journal');
  return j;
}

async function events(rig: Rig, auctionId: AuctionId): Promise<RoomEvent[]> {
  return rig.stores.store.readEvents(auctionId, 1, 10_000);
}

/** The end state every settled auction must reach, however often it crashed on the way. */
async function expectSettled(
  rig: Rig,
  run: Run,
  winner: Bidder,
  losers: Bidder[],
  priceCents: number,
): Promise<void> {
  const { core } = rig.paypal;
  const won = core.getAuthorization(winner.authId);
  expect(won.captures).toHaveLength(1);
  expect(won.captures[0]).toMatchObject({ amountCents: priceCents, final: true });
  expect(won.capturedCents).toBe(priceCents);
  for (const l of losers) expect(core.getAuthorization(l.authId).status).toBe('VOIDED');
  core.checkInvariants();

  const journal = await journalOf(rig, run.auctionId);
  expect(journal.state).toBe('SETTLED');
  expect(journal.winner).toMatchObject({ bidderId: winner.id, amountCents: priceCents });

  const updates = (await events(rig, run.auctionId)).filter((e) => e.type === 'settlement_update');
  const last = updates.at(-1);
  expect(last).toMatchObject({ auctionState: 'SETTLED', amountCaptured: priceCents });

  const state = evolveAll(await rig.stores.ledger.read(run.auctionId as unknown as Ulid, 1));
  expect(state.lots[run.auctionId]).toMatchObject({
    status: 'DONE',
    winnerId: winner.id,
    capturedCents: priceCents,
  });
  expect(state.closed).toBe(true);

  const status = async (b: Bidder): Promise<HoldRecord['status'] | undefined> =>
    (await rig.stores.holds.get(b.holdId))?.status;
  expect(await status(winner)).toBe('CAPTURED');
  for (const l of losers) expect(await status(l)).toBe('VOIDED');
}

/** A delivery signed the way the fake PayPal server verifies it. */
function signed(
  eventId: string,
  eventType: string,
  resource: Record<string, string | number>,
  tx: number,
): { rawBody: Buffer; headers: Record<string, string> } {
  const time = '2026-01-01T00:00:00.000Z';
  const rawBody = JSON.stringify({
    id: eventId,
    event_type: eventType,
    create_time: time,
    resource,
  });
  const id = `TX-T${tx}`;
  const mac = createHmac('sha256', 'gavel-fake-webhook-key');
  mac.update(`${id}|${time}|${DEFAULT_FAKE_WEBHOOK_ID}|`);
  mac.update(rawBody);
  return {
    rawBody: Buffer.from(rawBody, 'utf8'),
    headers: {
      'PAYPAL-AUTH-ALGO': 'FAKE-HMAC-SHA256',
      'PAYPAL-CERT-URL': 'http://127.0.0.1/__fake/cert',
      'PAYPAL-TRANSMISSION-ID': id,
      'PAYPAL-TRANSMISSION-SIG': mac.digest('hex'),
      'PAYPAL-TRANSMISSION-TIME': time,
    },
  };
}

describe('auction service: settlement end to end', () => {
  it('captures the winner, voids the others and tells every viewer', async () => {
    const rig = await makeRig();
    const errors: unknown[] = [];
    const service = rig.service({ onError: (_id, e) => errors.push(e) });
    const run = await runToHammer(rig, service);
    await service.idle();
    expect(errors).toEqual([]);

    await expectSettled(rig, run, run.a, [run.b, run.c], 13000);

    const mine = run.a.transport.messages('settlement_update');
    expect(mine.at(-1)).toMatchObject({
      auctionState: 'SETTLED',
      you: 'SETTLED',
      amountCaptured: 13000,
    });
    expect(run.b.transport.messages('settlement_update').at(-1)).toMatchObject({
      auctionState: 'SETTLED',
      you: 'SETTLED',
    });
    const screenRevs = run.screen.messages('settlement_update').map((m) => m['rev'] as number);
    expect(screenRevs.length).toBeGreaterThan(1);
    expect([...screenRevs].sort((x, y) => x - y)).toEqual(screenRevs);
    expect(run.screen.messages('hammer')).toMatchObject([{ winnerId: run.a.id, price: 13000 }]);
    await service.close();
  });

  it('settles after the end time through the auto-hammer', async () => {
    const rig = await makeRig();
    const service = rig.service();
    const auctionId = rig.ids.mint<'AuctionId'>();
    const room = await service.createAuction(
      auctionId,
      { ...config, autoHammerDelayMs: 3000 } as AuctionConfig,
      'auctioneer-sub',
    );
    const a = await enroll(rig, service, room, auctionId, 'Ada', 50000);
    const b = await enroll(rig, service, room, auctionId, 'Bo', 30000);
    await room.submitBid(a.conn, bid(rig, 10000));
    await room.submitBid(b.conn, bid(rig, 11000));
    rig.clock.set(START + 600_000);
    await connect(rig, room, 'screen');
    rig.clock.set(START + 603_000);
    await connect(rig, room, 'screen');
    await service.idle();
    const run: Run = { auctionId, room, a, b, c: b, screen: new MemoryTransport() };
    await expectSettled(rig, run, b, [a], 11000);
    await service.close();
  });

  it('skips a leader whose hold was voided by PayPal and charges the next bidder', async () => {
    const rig = await makeRig();
    const service = rig.service();
    const auctionId = rig.ids.mint<'AuctionId'>();
    const room = await service.createAuction(auctionId, config, 'auctioneer-sub');
    const a = await enroll(rig, service, room, auctionId, 'Ada', 50000);
    const d = await enroll(rig, service, room, auctionId, 'Di', 50000);
    await room.submitBid(a.conn, bid(rig, 10000));
    await room.submitBid(d.conn, bid(rig, 11000));
    // The buyer withdraws the authorization in PayPal before the hammer.
    rig.paypal.core.void(d.authId);
    let tx = 0;
    for (const e of rig.paypal.core.deliver('fifo')) {
      const hook = signed(e.id, e.eventType, e.resource, (tx += 1));
      expect((await service.handleWebhook(hook.rawBody, hook.headers)).status).toBe(200);
    }
    expect((await rig.stores.holds.get(d.holdId))?.status).toBe('VOIDED');
    const boss = await connect(rig, room, 'auctioneer');
    await room.control(boss.conn, { controlId: 'h', action: 'hammer', args: { closeNow: 1 } });
    await service.idle();
    const run: Run = { auctionId, room, a, b: d, c: d, screen: new MemoryTransport() };
    await expectSettled(rig, run, a, [], 10000);
    expect(rig.paypal.core.getAuthorization(d.authId).captures).toHaveLength(0);
    await service.close();
  });

  it('settles an auction nobody bid on by voiding every hold', async () => {
    const rig = await makeRig();
    const service = rig.service();
    const auctionId = rig.ids.mint<'AuctionId'>();
    const room = await service.createAuction(auctionId, config, 'auctioneer-sub');
    const a = await enroll(rig, service, room, auctionId, 'Ada', 50000);
    const boss = await connect(rig, room, 'auctioneer');
    await room.control(boss.conn, { controlId: 'h', action: 'hammer', args: { closeNow: 1 } });
    await service.idle();
    expect(rig.paypal.core.getAuthorization(a.authId)).toMatchObject({
      status: 'VOIDED',
      capturedCents: 0,
    });
    expect((await journalOf(rig, auctionId)).state).toBe('SETTLED');
    const last = (await events(rig, auctionId))
      .filter((e) => e.type === 'settlement_update')
      .at(-1);
    expect(last).toMatchObject({ auctionState: 'SETTLED' });
    await service.close();
  });
});

describe('auction service: room cap counts live rooms (R12-S02)', () => {
  it('evicts a settled, unconnected room to make space for a new auction', async () => {
    const rig = await makeRig();
    const service = rig.service({ caps: { ...DEFAULT_CAPS, rooms: 1 }, resumeIntervalMs: 0 });
    const first = rig.ids.mint<'AuctionId'>();
    const room = await service.createAuction(first, config, 'auctioneer-sub');
    const boss = await connect(rig, room, 'auctioneer');
    await room.control(boss.conn, { controlId: 'h', action: 'hammer', args: { closeNow: 1 } });
    await service.idle();
    expect(room.isDone).toBe(true);
    // While someone is connected the room stays and the cap holds.
    await expect(
      service.createAuction(rig.ids.mint<'AuctionId'>(), config, 'auctioneer-sub'),
    ).rejects.toMatchObject({ code: 'room_cap' });
    room.detach(boss.conn.id);
    const second = rig.ids.mint<'AuctionId'>();
    await service.createAuction(second, config, 'auctioneer-sub');
    expect(service.stats().rooms).toBe(1);
    await service.close();
  });
});

describe('auction service: eviction never drops unsettled rooms (HRD-42)', () => {
  it('keeps a finished room that still has a live hold and refuses the new auction', async () => {
    const rig = await makeRig();
    const service = rig.service({ caps: { ...DEFAULT_CAPS, rooms: 1 }, resumeIntervalMs: 0 });
    const first = rig.ids.mint<'AuctionId'>();
    const room = await service.createAuction(first, config, 'auctioneer-sub');
    const boss = await connect(rig, room, 'auctioneer');
    await room.control(boss.conn, { controlId: 'h', action: 'hammer', args: { closeNow: 1 } });
    await service.idle();
    expect(room.isDone).toBe(true);
    room.detach(boss.conn.id);
    // A hold that is still live after the settlement keeps the room loaded.
    const made = await rig.holdsApi.createHoldOrder({
      auctionId: first,
      bidderId: rig.ids.mint<'BidderId'>(),
      ceilingCents: 30000,
      presetsCents: config.ceilingPresets,
    });
    rig.paypal.core.approveOrder(made.orderId);
    await rig.holdsApi.completeApproval({ holdId: made.holdId, orderId: made.orderId });
    await expect(
      service.createAuction(rig.ids.mint<'AuctionId'>(), config, 'auctioneer-sub'),
    ).rejects.toMatchObject({ code: 'room_cap' });
    expect(service.stats().rooms).toBe(1);
    expect((await service.room(first)).isDone).toBe(true);
    // Once the hold is closed the room may go.
    const hold = await rig.stores.holds.get(made.holdId);
    if (hold === null) throw new Error('no hold');
    await rig.stores.holds.put({ ...hold, status: 'VOIDED' });
    await service.createAuction(rig.ids.mint<'AuctionId'>(), config, 'auctioneer-sub');
    expect(service.stats().rooms).toBe(1);
    await service.close();
  });
});

describe('auction service: resume under a room cap (R12-S02)', () => {
  it('loads a live auction after a restart although finished ones fill the cap', async () => {
    const rig = await makeRig();
    const first = rig.service({ resumeIntervalMs: 0 });
    const done = rig.ids.mint<'AuctionId'>();
    const doneRoom = await first.createAuction(done, config, 'auctioneer-sub');
    const boss = await connect(rig, doneRoom, 'auctioneer');
    await doneRoom.control(boss.conn, { controlId: 'h', action: 'hammer', args: { closeNow: 1 } });
    await first.idle();
    expect(doneRoom.isDone).toBe(true);
    const live = rig.ids.mint<'AuctionId'>();
    await first.createAuction(live, config, 'auctioneer-sub');
    await first.close();
    const errors: string[] = [];
    const second = rig.service({
      caps: { ...DEFAULT_CAPS, rooms: 1 },
      resumeIntervalMs: 0,
      onError: (id) => void errors.push(id),
    });
    await second.resume();
    expect(errors).toEqual([]);
    const room = await second.room(live);
    expect(room.isDone).toBe(false);
    await second.close();
  });
});

describe('auction service: resume skips finished auctions from the first pass (#1749)', () => {
  async function finishOne(rig: Rig): Promise<AuctionId> {
    const first = rig.service({ resumeIntervalMs: 0 });
    const id = rig.ids.mint<'AuctionId'>();
    const room = await first.createAuction(id, config, 'auctioneer-sub');
    const boss = await connect(rig, room, 'auctioneer');
    await room.control(boss.conn, { controlId: 'h', action: 'hammer', args: { closeNow: 1 } });
    await first.idle();
    expect(room.isDone).toBe(true);
    await first.close();
    return id;
  }

  it('does not replay a finished auction log in the first or later passes', async () => {
    const rig = await makeRig();
    await finishOne(rig);
    const replays: number[] = [];
    const read = rig.stores.store.readEvents.bind(rig.stores.store);
    rig.stores.store.readEvents = (id, from, limit) => {
      if (from === 1) replays.push(from);
      return read(id, from, limit);
    };
    const second = rig.service({ resumeIntervalMs: 0 });
    await second.resume();
    await second.resume();
    expect(replays).toEqual([]);
    expect(second.stats().rooms).toBe(0);
    await second.close();
  });

  it('keeps a finished auction that a client is connected to', async () => {
    const rig = await makeRig();
    const id = await finishOne(rig);
    const second = rig.service({ resumeIntervalMs: 0 });
    const room = await second.room(id);
    const viewer = await connect(rig, room, 'screen');
    await second.resume();
    await second.resume();
    expect(second.stats().rooms).toBe(1);
    expect(viewer.transport.closed).toBeUndefined();
    await second.close();
  });
});

describe('auction service: settlement paths under a full room cap (HRD-30)', () => {
  async function finished(rig: Rig, service: AuctionService): Promise<AuctionId> {
    const id = rig.ids.mint<'AuctionId'>();
    const room = await service.createAuction(id, config, 'auctioneer-sub');
    const boss = await connect(rig, room, 'auctioneer');
    await room.control(boss.conn, { controlId: 'h', action: 'hammer', args: { closeNow: 1 } });
    await service.idle();
    expect(room.isDone).toBe(true);
    room.detach(boss.conn.id);
    return id;
  }

  it('loads a stored auction beyond the cap when every loaded room is live', async () => {
    const rig = await makeRig();
    const first = rig.service({ resumeIntervalMs: 0 });
    const done = await finished(rig, first);
    await first.close();
    const second = rig.service({ caps: { ...DEFAULT_CAPS, rooms: 1 }, resumeIntervalMs: 0 });
    const live = rig.ids.mint<'AuctionId'>();
    await second.createAuction(live, config, 'auctioneer-sub');
    // A new load for a plain caller is still refused, a settlement path is not.
    await expect(second.room(done)).rejects.toMatchObject({ code: 'room_cap' });
    const room = await second.room(done, { settlement: true });
    expect(room.isDone).toBe(true);
    expect(second.stats().rooms).toBe(2);
    await second.close();
  });

  it('evicts the least recently used finished room before loading beyond the cap', async () => {
    const rig = await makeRig();
    const service = rig.service({ caps: { ...DEFAULT_CAPS, rooms: 2 }, resumeIntervalMs: 0 });
    const older = await finished(rig, service);
    rig.clock.set(START + 1_000);
    const newer = await finished(rig, service);
    rig.clock.set(START + 2_000);
    // Touch the older room, so the newer one is now the least recently used.
    await service.room(older);
    rig.clock.set(START + 3_000);
    const live = rig.ids.mint<'AuctionId'>();
    await service.createAuction(live, config, 'auctioneer-sub');
    expect(service.stats().rooms).toBe(2);
    const kept = await service.room(older);
    expect(kept.isDone).toBe(true);
    expect(service.stats().rooms).toBe(2);
    // The evicted one loads again from its log for a settlement path.
    const again = await service.room(newer, { settlement: true });
    expect(again.isDone).toBe(true);
    await service.close();
  });
});

describe('auction service: gauges and counters (R8-S03)', () => {
  it('counts loaded rooms and connections and hands the metrics to the rooms', async () => {
    const rig = await makeRig();
    const metrics = { bidAccepted: vi.fn(), bidRejected: vi.fn(), rateLimitHit: vi.fn() };
    const service = rig.service({ roomMetrics: metrics, resumeIntervalMs: 0 });
    expect(service.stats()).toEqual({ rooms: 0, connections: 0, mailboxDepth: 0 });
    const auctionId = rig.ids.mint<'AuctionId'>();
    const room = await service.createAuction(auctionId, config, 'auctioneer-sub');
    const a = await enroll(rig, service, room, auctionId, 'Ada', 50000);
    expect(service.stats()).toEqual({ rooms: 1, connections: 1, mailboxDepth: 0 });
    await room.submitBid(a.conn, bid(rig, 10000));
    expect(metrics.bidAccepted).toHaveBeenCalledTimes(1);
    await service.close();
  });
});

describe('auction service: bidder registration', () => {
  it('revokes a bidder whose hold was denied while the registration waited (R12-S10)', async () => {
    const rig = await makeRig();
    const inner = rig.stores.holds;
    let reads = 0;
    const holds: typeof inner = Object.assign(Object.create(inner) as typeof inner, {
      get: async (holdId: string) => {
        const h = await inner.get(holdId);
        reads += 1;
        // The webhook lands right after the registration read the hold as HELD.
        if (reads === 1 && h !== null) await inner.put({ ...h, status: 'DENIED' });
        return h;
      },
    });
    const service = rig.service({ holds });
    const auctionId = rig.ids.mint<'AuctionId'>();
    const room = await service.createAuction(auctionId, config, 'auctioneer-sub');
    const id = rig.ids.mint<'BidderId'>();
    const created = await rig.holdsApi.createHoldOrder({
      auctionId,
      bidderId: id,
      ceilingCents: 30000,
      presetsCents: config.ceilingPresets,
    });
    rig.paypal.core.approveOrder(created.orderId);
    await rig.holdsApi.completeApproval({ holdId: created.holdId, orderId: created.orderId });
    await service.registerBidder({ auctionId, bidderId: id, name: 'Ed', holdId: created.holdId });
    expect((await events(rig, auctionId)).map((e) => e.type)).toContain('ceiling_revoked');
    expect(room.activeEngine).toBeDefined();
    await service.close();
  });

  it('refuses a bidder without a held hold', async () => {
    const rig = await makeRig();
    const service = rig.service();
    const auctionId = rig.ids.mint<'AuctionId'>();
    await service.createAuction(auctionId, config, 'auctioneer-sub');
    const id = rig.ids.mint<'BidderId'>();
    const created = await rig.holdsApi.createHoldOrder({
      auctionId,
      bidderId: id,
      ceilingCents: 30000,
      presetsCents: config.ceilingPresets,
    });
    await expect(
      service.registerBidder({ auctionId, bidderId: id, name: 'Ed', holdId: created.holdId }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const other = rig.ids.mint<'BidderId'>();
    await expect(
      service.registerBidder({ auctionId, bidderId: other, name: 'Fi', holdId: 'HOLD-none' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await service.close();
  });
});

describe('auction service: webhooks', () => {
  it('applies a verified void to the hold and ignores a forged one', async () => {
    const rig = await makeRig();
    const service = rig.service();
    const auctionId = rig.ids.mint<'AuctionId'>();
    const room = await service.createAuction(auctionId, config, 'auctioneer-sub');
    const a = await enroll(rig, service, room, auctionId, 'Ada', 50000);
    const forged = signed('WH-F1', 'PAYMENT.AUTHORIZATION.VOIDED', { authId: a.authId }, 1);
    const tampered = Buffer.from(forged.rawBody.toString('utf8').replace('WH-F1', 'WH-F2'), 'utf8');
    expect((await service.handleWebhook(tampered, forged.headers)).status).toBe(401);
    expect((await rig.stores.holds.get(a.holdId))?.status).toBe('HELD');
    expect(await rig.stores.webhookEvents.listUnprocessed()).toEqual([]);

    // The buyer really withdraws the authorization at PayPal; only then does the event count.
    rig.paypal.core.void(a.authId);
    const good = signed('WH-G1', 'PAYMENT.AUTHORIZATION.VOIDED', { authId: a.authId }, 2);
    expect((await service.handleWebhook(good.rawBody, good.headers)).status).toBe(200);
    expect((await rig.stores.holds.get(a.holdId))?.status).toBe('VOIDED');
    // The same delivery again changes nothing.
    expect((await service.handleWebhook(good.rawBody, good.headers)).status).toBe(200);
    expect(await rig.stores.webhookEvents.listUnprocessed()).toEqual([]);
    await service.close();
  });

  it('ignores a void event while PayPal still holds the authorization (PAYMENTS-R3-11)', async () => {
    const rig = await makeRig();
    const service = rig.service();
    const auctionId = rig.ids.mint<'AuctionId'>();
    const room = await service.createAuction(auctionId, config, 'auctioneer-sub');
    const a = await enroll(rig, service, room, auctionId, 'Ada', 50000);
    // A delayed or reordered event for an authorization that is live.
    const late = signed('WH-L1', 'PAYMENT.AUTHORIZATION.VOIDED', { authId: a.authId }, 1);
    expect((await service.handleWebhook(late.rawBody, late.headers)).status).toBe(200);
    expect((await rig.stores.holds.get(a.holdId))?.status).toBe('HELD');
    expect(await rig.stores.webhookEvents.listUnprocessed()).toEqual([]);
    await service.close();
  });

  it('parks an event for an unknown hold and drops it after the window', async () => {
    const rig = await makeRig();
    const service = rig.service();
    const hook = signed('WH-O1', 'PAYMENT.AUTHORIZATION.VOIDED', { authId: 'AUTH-unknown' }, 1);
    expect((await service.handleWebhook(hook.rawBody, hook.headers)).status).toBe(200);
    expect(await rig.stores.webhookEvents.listUnprocessed()).toHaveLength(1);
    await service.resume();
    expect(await rig.stores.webhookEvents.listUnprocessed()).toHaveLength(1);
    rig.clock.set(START + 700_000);
    await service.resume();
    expect(await rig.stores.webhookEvents.listUnprocessed()).toEqual([]);
    await service.close();
  });
});

describe('auction service: crash at every boundary', () => {
  /** Runs the whole auction once and returns every boundary label the settlement passed. */
  async function boundaries(): Promise<string[]> {
    const rig = await makeRig();
    const labels: string[] = [];
    const service = rig.service({ boundary: (l) => void labels.push(l) });
    await runToHammer(rig, service);
    await service.idle();
    await service.close();
    return labels;
  }

  it('visits boundaries in every phase', async () => {
    const labels = await boundaries();
    for (const expected of [
      'before:settle',
      'mid:ledger-sync',
      'after:prepare',
      'after:create-settlement',
      'before:capture',
      'after:capture',
      'journaled:capture_ok',
      'before:void',
      'after:void',
      'journaled:all_released',
      'before:engine:CompleteLot',
      'after:engine:CompleteLot',
      'before:bridge',
      'after:bridge',
      'after:report',
    ]) {
      expect(labels).toContain(expected);
    }
    expect(labels.some((l) => l.startsWith('journaled:void_'))).toBe(true);
  });

  it('ends with exactly one capture whichever boundary the process dies at', async () => {
    const labels = await boundaries();
    const total = labels.length;
    expect(total).toBeGreaterThan(20);
    for (let crashAt = 0; crashAt < total; crashAt++) {
      const rig = await makeRig();
      let seen = 0;
      const first = rig.service({
        boundary: () => {
          if (seen++ === crashAt) throw new Error('process died');
        },
        onError: () => undefined,
      });
      const run = await runToHammer(rig, first);
      await first.idle();

      // A new process on the same stores picks the settlement up.
      const second = rig.service();
      await second.resume();
      await second.idle();
      try {
        await expectSettled(rig, run, run.a, [run.b, run.c], 13000);
      } catch (e) {
        const journal = await rig.stores.journals.load(run.auctionId);
        throw new Error(
          `crash at boundary ${crashAt} (${labels[crashAt]}) did not settle: ${String(e)}; journal ${JSON.stringify(
            journal === null
              ? null
              : {
                  state: journal.state,
                  history: journal.history.map((h) => h.label),
                  winner: journal.winner,
                  voids: journal.voids,
                },
          )}`,
          { cause: e },
        );
      }
      await second.close();
    }
  });
});

describe('auction service: round 3 blocking fixes (RT3)', () => {
  it('refuses a config the engine cannot run before anything is stored (SERVICE-R3-02)', async () => {
    const rig = await makeRig();
    const service = rig.service();
    const tooShort = { ...config, endTs: 500 } as unknown as AuctionConfig;
    const tooDear = { ...config, reserve: 150_000_000 } as unknown as AuctionConfig;
    for (const bad of [tooShort, tooDear]) {
      const id = rig.ids.mint<'AuctionId'>();
      await expect(service.createAuction(id, bad, 'auctioneer-sub')).rejects.toMatchObject({
        code: 'bad_message',
      });
    }
    expect(await rig.stores.store.listAuctions()).toHaveLength(0);
    await service.close();
  });

  it('resumes the other auctions when one cannot be loaded (SERVICE-R3-02)', async () => {
    const rig = await makeRig();
    const first = rig.service({
      boundary: (label) => {
        if (label === 'after:prepare') throw new Error('process died');
      },
      onError: () => undefined,
    });
    const poisoned = rig.ids.mint<'AuctionId'>();
    await rig.stores.store.appendEvents(poisoned, 0, [
      {
        type: 'auction_created',
        auctionId: poisoned,
        seq: 1,
        ts: START as EpochMs,
        config: { ...config, endTs: 500 } as unknown as AuctionConfig,
        auctioneerSub: 'x',
      },
    ]);
    const run = await runToHammer(rig, first);
    await first.idle();
    await first.close();
    const errors: string[] = [];
    const second = rig.service({ onError: (id) => void errors.push(id) });
    await second.resume();
    await second.idle();
    expect(errors).toContain(poisoned);
    await expectSettled(rig, run, run.a, [run.b, run.c], 13000);
    await second.close();
  });

  it('settles a hammered room whose first run died before the journal existed (SERVICE-R3-03)', async () => {
    const rig = await makeRig();
    let fail = true;
    const service = rig.service({
      boundary: (label) => {
        if (fail && label === 'after:prepare') {
          fail = false;
          throw new Error('store hiccup');
        }
      },
      onError: () => undefined,
    });
    const run = await runToHammer(rig, service);
    await service.idle();
    expect(await rig.stores.journals.load(run.auctionId)).toBeNull();
    // The same process, rooms cached: resume must drive the settlement again.
    await service.resume();
    await service.idle();
    await expectSettled(rig, run, run.a, [run.b, run.c], 13000);
    await service.close();
  });

  it('releases the winner remainder when PayPal does not (SERVICE-R3-06, INT-R3-02)', async () => {
    const rig = await makeRig({ autoReleaseRemainder: false });
    // An open remainder is G1 decision B; the default (A, recorded) sends no void (R12-P06).
    const service = rig.service({ remainderMode: 'B' });
    const run = await runToHammer(rig, service);
    await service.idle();
    await expectSettled(rig, run, run.a, [run.b, run.c], 13000);
    // Ada held 50000 and was charged 13000: the other 37000 is freed.
    expect(rig.paypal.core.released(run.a.authId)).toBe(37000);
    const journal = await journalOf(rig, run.auctionId);
    expect(journal.voids[`remainder:${run.a.id}`]).toBe('remainder_voided');
    await service.close();
  });

  it('keys the void records by bidder so reconcile finds no conflict (INT-R3-03)', async () => {
    const rig = await makeRig();
    const service = rig.service();
    const run = await runToHammer(rig, service);
    await service.idle();
    const journal = await journalOf(rig, run.auctionId);
    expect(Object.keys(journal.voids)).toContain(run.b.id);
    expect(Object.keys(journal.voids)).toContain(run.c.id);
    expect(Object.keys(journal.voids)).not.toContain(run.b.holdId);
    await service.close();
  });
});

describe('auction service: reconcile after settlement (INT-R3-15)', () => {
  it('runs reconcile once the journal is SETTLED and hands over the report', async () => {
    const rig = await makeRig();
    const reports: ReconcileReport[] = [];
    const service = rig.service({ onReconcile: (r) => void reports.push(r) });
    const run = await runToHammer(rig, service);
    await service.idle();
    await expectSettled(rig, run, run.a, [run.b, run.c], 13000);
    expect(reports.length).toBeGreaterThan(0);
    const last = reports[reports.length - 1];
    expect(last?.journalState).toBe('SETTLED');
    const bad = ['STATUS_CONFLICT', 'MISSING_CAPTURE', 'EXTRA_CAPTURE', 'AMOUNT_MISMATCH'];
    expect((last?.findings ?? []).filter((f) => bad.includes(f.code))).toEqual([]);
    await service.close();
  });

  it('keeps the settlement settled when the report handler throws', async () => {
    const rig = await makeRig();
    const errors: unknown[] = [];
    const service = rig.service({
      onReconcile: () => {
        throw new Error('sink down');
      },
      onError: (_id, e) => void errors.push(e),
    });
    const run = await runToHammer(rig, service);
    await service.idle();
    await expectSettled(rig, run, run.a, [run.b, run.c], 13000);
    expect(errors.length).toBeGreaterThan(0);
    await service.close();
  });
});

describe('auction service: round 3 hardening (RT3)', () => {
  it('refuses an end time the engine lot cannot reach yet (SERVICE-R3-12)', async () => {
    const rig = await makeRig();
    const service = rig.service();
    const far = { ...config, endTs: START + 3 * 86_400_000 } as unknown as AuctionConfig;
    await expect(
      service.createAuction(rig.ids.mint<'AuctionId'>(), far, 'auctioneer-sub'),
    ).rejects.toMatchObject({ code: 'bad_message' });
    expect(await rig.stores.store.listAuctions()).toHaveLength(0);
    await service.close();
  });

  it('refuses modes, increment ladders and lot holds the engine adapter cannot run (R6-D06)', async () => {
    const rig = await makeRig();
    const service = rig.service();
    const variants: Array<Record<string, unknown>> = [
      { mode: 'proxy' },
      { mode: 'second_price' },
      { holdScope: 'lot' },
      { incrementLadder: [{ fromCents: 0, incrementCents: 500 }] },
    ];
    for (const extra of variants) {
      const bad = { ...config, ...extra } as unknown as AuctionConfig;
      await expect(
        service.createAuction(rig.ids.mint<'AuctionId'>(), bad, 'auctioneer-sub'),
      ).rejects.toMatchObject({ code: 'bad_message' });
    }
    expect(await rig.stores.store.listAuctions()).toHaveLength(0);
    await service.close();
  });

  it('uses the room engine, so the settlement sees every registration (SERVICE-R3-10)', async () => {
    const rig = await makeRig();
    const service = rig.service();
    const run = await runToHammer(rig, service);
    await service.idle();
    expect(run.room.activeEngine).toBeDefined();
    await expectSettled(rig, run, run.a, [run.b, run.c], 13000);
    await service.close();
  });
});

/** A ledger store whose appends can be made to fail, like a full disk. */
class FlakyLedger extends InMemoryLedgerStore {
  failing = false;

  override append(
    ...args: Parameters<InMemoryLedgerStore['append']>
  ): ReturnType<InMemoryLedgerStore['append']> {
    if (this.failing) return Promise.reject(new Error('disk full'));
    return super.append(...args);
  }
}

async function ledgerState(rig: Rig, auctionId: AuctionId): Promise<ReturnType<typeof evolveAll>> {
  return evolveAll(await rig.stores.ledger.read(auctionId as unknown as Ulid, 1));
}

async function ledgerTypes(rig: Rig, auctionId: AuctionId): Promise<string[]> {
  return (await rig.stores.ledger.read(auctionId as unknown as Ulid, 1)).map((e) => e.type);
}

async function deliverVoids(rig: Rig, service: AuctionService, tx: number): Promise<void> {
  let n = tx;
  for (const e of rig.paypal.core.deliver('fifo')) {
    const hook = signed(e.id, e.eventType, e.resource, (n += 1));
    expect((await service.handleWebhook(hook.rawBody, hook.headers)).status).toBe(200);
  }
}

describe('auction service: ledger before acknowledgement (D-0014)', () => {
  it('has every accepted bid in the engine ledger while the lot is still open', async () => {
    const rig = await makeRig();
    const service = rig.service();
    const auctionId = rig.ids.mint<'AuctionId'>();
    const room = await service.createAuction(auctionId, config, 'auctioneer-sub');
    const a = await enroll(rig, service, room, auctionId, 'Ada', 50000);
    const b = await enroll(rig, service, room, auctionId, 'Bo', 30000);
    await room.submitBid(a.conn, bid(rig, 10000));
    await room.submitBid(b.conn, bid(rig, 10500));
    await room.submitBid(a.conn, bid(rig, 12000));

    const types = await ledgerTypes(rig, auctionId);
    expect(types.filter((t) => t === 'BID_RECORDED')).toHaveLength(3);
    expect(types).not.toContain('LOT_HAMMERED');
    const state = await ledgerState(rig, auctionId);
    expect(state.lots[auctionId]?.status).toBe('OPEN');
    await service.close();
  });

  it('withholds the acknowledgement while the ledger write fails and sends it after', async () => {
    const rig = await makeRig();
    const ledger = new FlakyLedger();
    rig.stores.ledger = ledger;
    const service = rig.service();
    const auctionId = rig.ids.mint<'AuctionId'>();
    const room = await service.createAuction(auctionId, config, 'auctioneer-sub');
    const a = await enroll(rig, service, room, auctionId, 'Ada', 50000);

    ledger.failing = true;
    const msg = bid(rig, 10000);
    await room.submitBid(a.conn, msg);
    expect(a.transport.messages('bid_accepted')).toHaveLength(0);
    expect(a.transport.messages('error').at(-1)).toMatchObject({ code: 'store_unavailable' });
    expect(await ledgerTypes(rig, auctionId)).not.toContain('BID_RECORDED');

    ledger.failing = false;
    await room.submitBid(a.conn, msg);
    expect(a.transport.messages('bid_accepted')).toHaveLength(1);
    expect((await ledgerTypes(rig, auctionId)).filter((t) => t === 'BID_RECORDED')).toHaveLength(1);
    // The same message again is answered from the stored reply and adds nothing.
    await room.submitBid(a.conn, msg);
    expect((await ledgerTypes(rig, auctionId)).filter((t) => t === 'BID_RECORDED')).toHaveLength(1);
    await service.close();
  });
});

describe('auction service: revoke before the hammer (D-0016)', () => {
  it('drops a leader whose hold was voided and keeps that across a restart', async () => {
    const rig = await makeRig();
    const service = rig.service();
    const auctionId = rig.ids.mint<'AuctionId'>();
    const room = await service.createAuction(auctionId, config, 'auctioneer-sub');
    const a = await enroll(rig, service, room, auctionId, 'Ada', 50000);
    const d = await enroll(rig, service, room, auctionId, 'Di', 50000);
    await room.submitBid(a.conn, bid(rig, 10000));
    await room.submitBid(d.conn, bid(rig, 11000));
    expect(room.activeEngine?.view().leader).toBe(d.id);

    rig.paypal.core.void(d.authId);
    await deliverVoids(rig, service, 0);

    expect(room.activeEngine?.view()).toMatchObject({ leader: a.id, price: 10000 });
    expect((await events(rig, auctionId)).map((e) => e.type)).toContain('ceiling_revoked');
    expect(await ledgerTypes(rig, auctionId)).toContain('CEILING_REVOKED');
    // The revoked bidder can no longer bid.
    await room.submitBid(d.conn, bid(rig, 20000));
    expect(d.transport.messages('bid_rejected').at(-1)).toMatchObject({ reason: 'unregistered' });
    await service.close();

    const second = rig.service();
    const again = await second.room(auctionId);
    expect(again.activeEngine?.view()).toMatchObject({ leader: a.id, price: 10000 });
    await second.close();
  });

  it('repeats a revoke whose delivery died before the ledger had it (SERVICE-R3-11)', async () => {
    const rig = await makeRig();
    const ledger = new FlakyLedger();
    rig.stores.ledger = ledger;
    const service = rig.service();
    const auctionId = rig.ids.mint<'AuctionId'>();
    const room = await service.createAuction(auctionId, config, 'auctioneer-sub');
    const a = await enroll(rig, service, room, auctionId, 'Ada', 50000);
    const d = await enroll(rig, service, room, auctionId, 'Di', 50000);
    await room.submitBid(a.conn, bid(rig, 10000));
    await room.submitBid(d.conn, bid(rig, 11000));

    // The hold is saved VOIDED, then the process cannot write the ledger: the event stays open.
    ledger.failing = true;
    rig.paypal.core.void(d.authId);
    await deliverVoids(rig, service, 0);
    expect((await rig.stores.holds.get(d.holdId))?.status).toBe('VOIDED');
    expect(await rig.stores.webhookEvents.listUnprocessed()).toHaveLength(1);
    expect(await ledgerTypes(rig, auctionId)).not.toContain('CEILING_REVOKED');

    ledger.failing = false;
    await service.resume();
    expect(await rig.stores.webhookEvents.listUnprocessed()).toEqual([]);
    expect(await ledgerTypes(rig, auctionId)).toContain('CEILING_REVOKED');
    await service.close();
  });
});

describe('auction service: kill switch before the hammer (D-0015)', () => {
  /** Two bidders with bids on an open lot, then the operator engages the switch. */
  async function openThenEngage(rig: Rig, service: AuctionService): Promise<Run> {
    const auctionId = rig.ids.mint<'AuctionId'>();
    const room = await service.createAuction(auctionId, config, 'auctioneer-sub');
    const a = await enroll(rig, service, room, auctionId, 'Ada', 50000);
    const b = await enroll(rig, service, room, auctionId, 'Bo', 30000);
    const screen = await connect(rig, room, 'screen');
    await room.submitBid(a.conn, bid(rig, 10000));
    await room.submitBid(b.conn, bid(rig, 10500));
    await rig.killSwitch.engage('operator stop', 'ops');
    return { auctionId, room, a, b, c: b, screen: screen.transport };
  }

  async function expectAborted(rig: Rig, run: Run): Promise<void> {
    for (const h of [run.a, run.b]) {
      expect(rig.paypal.core.getAuthorization(h.authId)).toMatchObject({
        status: 'VOIDED',
        capturedCents: 0,
      });
    }
    rig.paypal.core.checkInvariants();
    expect((await journalOf(rig, run.auctionId)).state).toBe('SETTLED');
    const state = await ledgerState(rig, run.auctionId);
    expect(state.lots[run.auctionId]).toMatchObject({
      status: 'DONE',
      winnerId: null,
      abortReason: 'kill_switch',
    });
    expect(state.closed).toBe(true);
    const log = await events(rig, run.auctionId);
    expect(log.find((e) => e.type === 'hammered')).toMatchObject({ winnerId: null });
    expect(log.filter((e) => e.type === 'settlement_update').at(-1)).toMatchObject({
      auctionState: 'SETTLED',
    });
  }

  it('aborts the open lot, voids every hold and tells the room', async () => {
    const rig = await makeRig();
    const errors: unknown[] = [];
    const service = rig.service({ killSwitch: rig.killSwitch, onError: (_i, e) => errors.push(e) });
    const run = await openThenEngage(rig, service);

    expect(await service.abortOpenLots()).toEqual([run.auctionId]);
    await service.idle();
    expect(errors).toEqual([]);
    await expectAborted(rig, run);
    expect(await ledgerTypes(rig, run.auctionId)).toContain('LOT_ABORTED');
    expect(run.a.transport.messages('settlement_update').at(-1)).toMatchObject({
      auctionState: 'SETTLED',
    });
    // A second call finds nothing left to abort.
    expect(await service.abortOpenLots()).toEqual([]);
    await service.close();
  });

  it('leaves everything alone while the switch is released', async () => {
    const rig = await makeRig();
    const service = rig.service({ killSwitch: rig.killSwitch });
    const auctionId = rig.ids.mint<'AuctionId'>();
    await service.createAuction(auctionId, config, 'auctioneer-sub');
    expect(await service.abortOpenLots()).toEqual([]);
    await service.close();
  });

  it(
    'finishes the abort whichever boundary the process dies at',
    { timeout: 300_000 },
    async () => {
      const labels: string[] = [];
      {
        const rig = await makeRig();
        const service = rig.service({
          killSwitch: rig.killSwitch,
          boundary: (l) => void labels.push(l),
        });
        await openThenEngage(rig, service);
        await service.abortOpenLots();
        await service.idle();
        await service.close();
      }
      expect(labels).toContain('before:abort');
      expect(labels).toContain('mid:ledger-sync');
      for (let crashAt = 0; crashAt < labels.length; crashAt++) {
        const rig = await makeRig();
        let seen = 0;
        const first = rig.service({
          killSwitch: rig.killSwitch,
          boundary: () => {
            if (seen++ === crashAt) throw new Error('process died');
          },
          onError: () => undefined,
        });
        const run = await openThenEngage(rig, first);
        await first.abortOpenLots();
        await first.idle();

        const second = rig.service({ killSwitch: rig.killSwitch });
        await second.resume();
        await second.idle();
        try {
          await expectAborted(rig, run);
        } catch (e) {
          throw new Error(
            `crash at boundary ${crashAt} (${labels[crashAt]}) did not abort: ${String(e)}`,
            {
              cause: e,
            },
          );
        }
        await second.close();
      }
    },
  );
});

describe('auction service: crash matrix on durable stores (SERVICE-R3-17)', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  /** The room log, the ledger and the payment journal as files, opened fresh each time. */
  async function openFiles(rig: Rig, dir: string): Promise<void> {
    const store = await FileRoomStore.open(join(dir, 'room.jsonl'), () => rig.clock.now());
    Object.assign(rig.stores, {
      store,
      ledger: new FileLedgerStore(join(dir, 'ledger')),
      journals: new RoomJournalStore(store),
    });
  }

  it(
    'settles after a death at every boundary with the files reopened from disk',
    { timeout: 300_000 },
    async () => {
      const labels: string[] = [];
      {
        const dir = mkdtempSync(join(tmpdir(), 'gavel-matrix-'));
        dirs.push(dir);
        const rig = await makeRig();
        await openFiles(rig, dir);
        const service = rig.service({ boundary: (l) => void labels.push(l) });
        await runToHammer(rig, service);
        await service.idle();
        await service.close();
        (rig.stores.store as FileRoomStore).close();
      }
      expect(labels.length).toBeGreaterThan(20);
      for (let crashAt = 0; crashAt < labels.length; crashAt++) {
        const dir = mkdtempSync(join(tmpdir(), 'gavel-matrix-'));
        dirs.push(dir);
        const rig = await makeRig();
        await openFiles(rig, dir);
        let seen = 0;
        const first = rig.service({
          boundary: () => {
            if (seen++ === crashAt) throw new Error('process died');
          },
          onError: () => undefined,
        });
        const run = await runToHammer(rig, first);
        await first.idle();
        (rig.stores.store as FileRoomStore).close();

        // A new process opens the same files again.
        await openFiles(rig, dir);
        const second = rig.service();
        await second.resume();
        await second.idle();
        try {
          await expectSettled(rig, run, run.a, [run.b, run.c], 13000);
        } catch (e) {
          throw new Error(`crash at boundary ${crashAt} (${labels[crashAt]}): ${String(e)}`, {
            cause: e,
          });
        }
        await second.close();
        (rig.stores.store as FileRoomStore).close();
      }
    },
  );
});

describe('auction service: unfinished settlements and spare holds (RT-81)', () => {
  /** Two bidders bid, the operator stops the switch, then the auctioneer hammers. */
  async function hammerWithSwitchEngaged(rig: Rig, service: AuctionService): Promise<Run> {
    const auctionId = rig.ids.mint<'AuctionId'>();
    const room = await service.createAuction(auctionId, config, 'auctioneer-sub');
    const a = await enroll(rig, service, room, auctionId, 'Ada', 50000);
    const b = await enroll(rig, service, room, auctionId, 'Bo', 30000);
    await room.submitBid(a.conn, bid(rig, 10000));
    await room.submitBid(b.conn, bid(rig, 10500));
    await rig.killSwitch.engage('operator stop', 'ops');
    const boss = await connect(rig, room, 'auctioneer');
    await room.control(boss.conn, { controlId: 'h', action: 'hammer', args: { closeNow: 1 } });
    return { auctionId, room, a, b, c: b, screen: new MemoryTransport() };
  }

  it('tries a waiting settlement again on its own (INT-R3-05)', async () => {
    const rig = await makeRig();
    const service = rig.service({
      killSwitch: rig.killSwitch,
      retryDelayMs: 10,
      resumeIntervalMs: 0,
    });
    const run = await hammerWithSwitchEngaged(rig, service);
    await service.idle();
    // The capture waits while the switch is engaged; nothing is charged.
    expect((await journalOf(rig, run.auctionId)).state).not.toBe('SETTLED');
    expect(rig.paypal.core.getAuthorization(run.b.authId).captures).toHaveLength(0);

    await rig.killSwitch.release('ops');
    await vi.waitFor(async () => {
      expect((await journalOf(rig, run.auctionId)).state).toBe('SETTLED');
    });
    await service.idle();
    await expectSettled(rig, run, run.b, [run.a], 10500);
    await service.close();
  });

  it('runs resume on a timer (INT-R3-05)', async () => {
    const rig = await makeRig();
    const first = rig.service({ killSwitch: rig.killSwitch, retryDelayMs: 3_600_000 });
    const run = await hammerWithSwitchEngaged(rig, first);
    await first.idle();
    await first.close();
    await rig.killSwitch.release('ops');

    const second = rig.service({ resumeIntervalMs: 20 });
    await vi.waitFor(async () => {
      expect((await journalOf(rig, run.auctionId)).state).toBe('SETTLED');
    });
    await second.idle();
    await expectSettled(rig, run, run.b, [run.a], 10500);
    await second.close();
  });

  it('keeps the next candidate and releases the other holds when the settlement ends in review (INT-R3-06, R11-O01)', async () => {
    const rig = await makeRig();
    const errors: unknown[] = [];
    const service = rig.service({
      retryDelayMs: 10,
      resumeIntervalMs: 0,
      unknownDeadlineMs: 1_000,
      onError: (_id, e) => errors.push(e),
    });
    // The capture request times out, so its outcome stays unknown.
    rig.paypal.core.inject('capture', 'timeout_before', null, 1000);
    const auctionId = rig.ids.mint<'AuctionId'>();
    const room = await service.createAuction(auctionId, config, 'auctioneer-sub');
    const a = await enroll(rig, service, room, auctionId, 'Ada', 50000);
    const b = await enroll(rig, service, room, auctionId, 'Bo', 30000);
    const c = await enroll(rig, service, room, auctionId, 'Cy', 30000);
    await room.submitBid(b.conn, bid(rig, 10000));
    await room.submitBid(a.conn, bid(rig, 11000));
    const boss = await connect(rig, room, 'auctioneer');
    await room.control(boss.conn, { controlId: 'h', action: 'hammer', args: { closeNow: 1 } });
    await service.idle();
    expect((await journalOf(rig, auctionId)).state).toBe('CAPTURING');

    // Ten seconds later the unknown outcome is past its deadline.
    rig.clock.set(START + 10_000);
    await vi.waitFor(async () => {
      expect((await journalOf(rig, auctionId)).state).toBe('FAILED_NEEDS_REVIEW');
    });
    await service.idle();
    // Cy never bid: nothing can fall back to that hold.
    expect(rig.paypal.core.getAuthorization(c.authId).status).toBe('VOIDED');
    expect((await rig.stores.holds.get(c.holdId))?.status).toBe('VOIDED');
    // R9-M04 through the composed server: Bo is the next candidate. If Ada's capture never
    // happened the lot can still fall back to Bo, so Bo's authorization stays live.
    expect(rig.paypal.core.getAuthorization(b.authId).status).toBe('CREATED');
    expect((await rig.stores.holds.get(b.holdId))?.status).toBe('HELD');
    // The hold with the unresolved capture is not touched.
    expect(rig.paypal.core.getAuthorization(a.authId).status).not.toBe('VOIDED');
    await service.close();
  });

  /** Ada's capture times out until the review; Bo is the next candidate. */
  async function reviewWithRunnerUp(
    rig: Rig,
    extra: Partial<AuctionServiceDeps> = {},
  ): Promise<{ service: AuctionService; auctionId: AuctionId; a: Bidder; b: Bidder }> {
    const service = rig.service({
      retryDelayMs: 3_600_000,
      resumeIntervalMs: 0,
      unknownDeadlineMs: 1_000,
      onError: () => undefined,
      ...extra,
    });
    rig.paypal.core.inject('capture', 'timeout_before', null, 1000);
    const auctionId = rig.ids.mint<'AuctionId'>();
    const room = await service.createAuction(auctionId, config, 'auctioneer-sub');
    const a = await enroll(rig, service, room, auctionId, 'Ada', 50000);
    const b = await enroll(rig, service, room, auctionId, 'Bo', 30000);
    await room.submitBid(b.conn, bid(rig, 10000));
    await room.submitBid(a.conn, bid(rig, 11000));
    const boss = await connect(rig, room, 'auctioneer');
    await room.control(boss.conn, { controlId: 'h', action: 'hammer', args: { closeNow: 1 } });
    await service.idle();
    rig.clock.set(START + 10_000);
    await service.resume();
    await service.idle();
    expect((await journalOf(rig, auctionId)).state).toBe('FAILED_NEEDS_REVIEW');
    expect(rig.paypal.core.getAuthorization(b.authId).status).toBe('CREATED');
    return { service, auctionId, a, b };
  }

  it('releases the next candidate once the review is older than reviewHoldMaxAgeMs (R11-O01)', async () => {
    const rig = await makeRig();
    const { service, a, b } = await reviewWithRunnerUp(rig, { reviewHoldMaxAgeMs: 60_000 });
    // Still inside the age limit: a resume leaves Bo alone.
    rig.clock.set(START + 50_000);
    await service.resume();
    await service.idle();
    expect(rig.paypal.core.getAuthorization(b.authId).status).toBe('CREATED');
    rig.clock.set(START + 80_000);
    await service.resume();
    await service.idle();
    expect(rig.paypal.core.getAuthorization(b.authId).status).toBe('VOIDED');
    expect((await rig.stores.holds.get(b.holdId))?.status).toBe('VOIDED');
    // The capture in doubt keeps its hold until an operator resolves it.
    expect(rig.paypal.core.getAuthorization(a.authId).status).toBe('CREATED');
    await service.close();
  });

  it('an operator releases the next candidate of a fresh review (R11-O01)', async () => {
    const rig = await makeRig();
    const { service, auctionId, a, b } = await reviewWithRunnerUp(rig);
    expect(await service.releaseReviewHolds(auctionId, 'ops-7')).toBe('released');
    expect(rig.paypal.core.getAuthorization(b.authId).status).toBe('VOIDED');
    expect((await rig.stores.holds.get(b.holdId))?.status).toBe('VOIDED');
    expect(rig.paypal.core.getAuthorization(a.authId).status).toBe('CREATED');
    expect(rig.audits).toContainEqual(
      expect.objectContaining({ kind: 'void_all', label: 'review_release', actor: 'ops-7' }),
    );
    await service.close();
  });

  it('releases the last candidate of a no-sale review raised in the void phase (R11-O04)', async () => {
    const rig = await makeRig();
    const service = rig.service({
      retryDelayMs: 3_600_000,
      resumeIntervalMs: 0,
      onError: () => undefined,
    });
    const auctionId = rig.ids.mint<'AuctionId'>();
    const room = await service.createAuction(auctionId, config, 'auctioneer-sub');
    const a = await enroll(rig, service, room, auctionId, 'Ada', 50000);
    const b = await enroll(rig, service, room, auctionId, 'Bo', 30000);
    // Both captures are declined: no sale. Bo's void then fails at PayPal for a long time.
    rig.paypal.faults.add({ kind: 'capture_declined', op: 'capture', times: 2 });
    rig.paypal.faults.add({ kind: 'http_500', op: 'void', authId: b.authId, times: 100_000 });
    await room.submitBid(b.conn, bid(rig, 10000));
    await room.submitBid(a.conn, bid(rig, 11000));
    const boss = await connect(rig, room, 'auctioneer');
    await room.control(boss.conn, { controlId: 'h', action: 'hammer', args: { closeNow: 1 } });
    await service.idle();
    expect((await journalOf(rig, auctionId)).state).toBe('VOIDING');
    // Past the unknown deadline of the void: review, with Bo's authorization still live.
    rig.clock.set(START + 700_000);
    await service.resume();
    await service.idle();
    const review = await journalOf(rig, auctionId);
    expect(review.state).toBe('FAILED_NEEDS_REVIEW');
    expect(review.winner).toBeNull();
    expect(review.history.at(-1)?.label).toBe('journaled:void_unconfirmed:' + b.id);
    expect(rig.paypal.core.getAuthorization(b.authId).status).toBe('CREATED');
    // PayPal recovers. No capture on Bo can be pending, so a resume releases the hold.
    rig.paypal.faults.clear();
    await service.resume();
    await service.idle();
    expect(rig.paypal.core.getAuthorization(b.authId).status).toBe('VOIDED');
    expect((await rig.stores.holds.get(b.holdId))?.status).toBe('VOIDED');
    expect(rig.paypal.core.getAuthorization(a.authId).captures).toHaveLength(0);
    await service.close();
  });

  it('voidAll during a capture in flight is busy (R11-O05)', async () => {
    const rig = await makeRig();
    const ref: { service?: AuctionService; during?: VoidAllOutcome } = {};
    const service = rig.service({
      leaseOwner: 'host-1',
      boundary: async (label) => {
        const svc = ref.service;
        if (label !== 'before:capture' || ref.during !== undefined || svc === undefined) return;
        // An operator asks to void every hold while the winner's capture is about to go out.
        const id = [...(await rig.stores.store.listAuctions())][0] ?? '';
        ref.during = await svc.voidAll(id as AuctionId, 'ops-1');
      },
    });
    ref.service = service;
    const run = await runToHammer(rig, service);
    await service.idle();
    const during = ref.during;
    expect(during).toEqual({ status: 'busy' });
    await expectSettled(rig, run, run.a, [run.b, run.c], 13000);
    await service.close();
  });

  it('a capture PayPal holds as PENDING is not booked, and its denial falls back (R11-O03)', async () => {
    const rig = await makeRig();
    const service = rig.service({
      retryDelayMs: 3_600_000,
      resumeIntervalMs: 0,
      onError: () => undefined,
    });
    const auctionId = rig.ids.mint<'AuctionId'>();
    const room = await service.createAuction(auctionId, config, 'auctioneer-sub');
    const a = await enroll(rig, service, room, auctionId, 'Ada', 50000);
    const b = await enroll(rig, service, room, auctionId, 'Bo', 30000);
    rig.paypal.core.inject('capture', 'capture_pending', a.authId);
    await room.submitBid(b.conn, bid(rig, 10000));
    await room.submitBid(a.conn, bid(rig, 11000));
    const boss = await connect(rig, room, 'auctioneer');
    await room.control(boss.conn, { controlId: 'h', action: 'hammer', args: { closeNow: 1 } });
    await service.idle();
    const waiting = await journalOf(rig, auctionId);
    expect(waiting.state).toBe('CAPTURING');
    expect(waiting.winner).toBeNull();
    expect(rig.paypal.core.getAuthorization(b.authId).status).toBe('CREATED');

    // PayPal declines the pending capture and says so; the event alone starts the next run.
    const captureId = rig.paypal.core.getAuthorization(a.authId).captures[0]?.id ?? '';
    rig.paypal.core.denyCapture(captureId);
    const hook = signed('WH-D1', 'PAYMENT.CAPTURE.DENIED', { authId: a.authId, captureId }, 1);
    expect((await service.handleWebhook(hook.rawBody, hook.headers)).status).toBe(200);
    await service.idle();
    const done = await journalOf(rig, auctionId);
    expect(done.state).toBe('SETTLED');
    expect(done.winner).toMatchObject({ bidderId: b.id, amountCents: 10000 });
    expect(done.failed).toEqual([{ bidderId: a.id, reason: 'capture_declined' }]);
    expect(rig.paypal.core.getAuthorization(a.authId)).toMatchObject({
      status: 'VOIDED',
      capturedCents: 0,
    });
    expect(rig.paypal.core.getAuthorization(b.authId).capturedCents).toBe(10000);
    rig.paypal.core.checkInvariants();
    await service.close();
  });

  it('frees the hold nobody can be charged on while a capture is PENDING (RT4-saga-03)', async () => {
    const rig = await makeRig();
    const service = rig.service({
      retryDelayMs: 3_600_000,
      resumeIntervalMs: 0,
      onError: () => undefined,
    });
    const auctionId = rig.ids.mint<'AuctionId'>();
    const room = await service.createAuction(auctionId, config, 'auctioneer-sub');
    const a = await enroll(rig, service, room, auctionId, 'Ada', 50000);
    const b = await enroll(rig, service, room, auctionId, 'Bo', 30000);
    const c = await enroll(rig, service, room, auctionId, 'Cy', 30000);
    rig.paypal.core.inject('capture', 'capture_pending', a.authId);
    await room.submitBid(b.conn, bid(rig, 10000));
    await room.submitBid(a.conn, bid(rig, 11000));
    const boss = await connect(rig, room, 'auctioneer');
    await room.control(boss.conn, { controlId: 'h', action: 'hammer', args: { closeNow: 1 } });
    await service.idle();
    const waiting = await journalOf(rig, auctionId);
    expect(waiting.state).toBe('CAPTURING');
    expect(waiting.winner).toBeNull();
    // Cy never bid: no capture and no fallback can reach that hold, so it is freed now.
    expect(rig.paypal.core.getAuthorization(c.authId).status).toBe('VOIDED');
    expect((await rig.stores.holds.get(c.holdId))?.status).toBe('VOIDED');
    // The capture in doubt and the runner-up keep theirs.
    expect(rig.paypal.core.getAuthorization(b.authId).status).toBe('CREATED');
    expect((await rig.stores.holds.get(b.holdId))?.status).toBe('HELD');
    expect(rig.paypal.core.getAuthorization(a.authId).status).not.toBe('VOIDED');
    await service.close();
  });

  it('a capture PayPal holds as PENDING for hours is booked once PayPal completes it (R12-P01)', async () => {
    const rig = await makeRig();
    const service = rig.service({
      retryDelayMs: 3_600_000,
      resumeIntervalMs: 0,
      onError: () => undefined,
    });
    const auctionId = rig.ids.mint<'AuctionId'>();
    const room = await service.createAuction(auctionId, config, 'auctioneer-sub');
    const a = await enroll(rig, service, room, auctionId, 'Ada', 50000);
    const b = await enroll(rig, service, room, auctionId, 'Bo', 30000);
    rig.paypal.core.inject('capture', 'capture_pending', a.authId);
    await room.submitBid(b.conn, bid(rig, 10000));
    await room.submitBid(a.conn, bid(rig, 11000));
    const boss = await connect(rig, room, 'auctioneer');
    await room.control(boss.conn, { controlId: 'h', action: 'hammer', args: { closeNow: 1 } });
    await service.idle();

    // Two hours later PayPal still lists it PENDING: far past the ten-minute deadline of a
    // lost answer, well inside the pending-capture deadline.
    rig.clock.set(START + 7_200_000);
    await service.resume();
    await service.idle();
    expect((await journalOf(rig, auctionId)).state).toBe('CAPTURING');
    expect(rig.paypal.core.getAuthorization(b.authId).status).toBe('CREATED');

    const captureId = rig.paypal.core.getAuthorization(a.authId).captures[0]?.id ?? '';
    rig.paypal.core.completeCapture(captureId);
    const hook = signed('WH-C1', 'PAYMENT.CAPTURE.COMPLETED', { authId: a.authId, captureId }, 1);
    expect((await service.handleWebhook(hook.rawBody, hook.headers)).status).toBe(200);
    await service.idle();
    const done = await journalOf(rig, auctionId);
    expect(done.state).toBe('SETTLED');
    expect(done.winner).toMatchObject({ bidderId: a.id, amountCents: 11000 });
    expect(rig.paypal.core.getAuthorization(a.authId).capturedCents).toBe(11000);
    expect(rig.paypal.core.getAuthorization(b.authId).status).toBe('VOIDED');
    rig.paypal.core.checkInvariants();
    await service.close();
  });

  it('does not run a review settlement again while its kept hold stays held (R8-S06)', async () => {
    const rig = await makeRig();
    const errors: unknown[] = [];
    const service = rig.service({
      retryDelayMs: 10,
      resumeIntervalMs: 0,
      unknownDeadlineMs: 1_000,
      onError: (_id, e) => errors.push(e),
    });
    rig.paypal.core.inject('capture', 'timeout_before', null, 1000);
    const auctionId = rig.ids.mint<'AuctionId'>();
    const room = await service.createAuction(auctionId, config, 'auctioneer-sub');
    const a = await enroll(rig, service, room, auctionId, 'Ada', 50000);
    const b = await enroll(rig, service, room, auctionId, 'Bo', 30000);
    await room.submitBid(b.conn, bid(rig, 10000));
    await room.submitBid(a.conn, bid(rig, 11000));
    const boss = await connect(rig, room, 'auctioneer');
    await room.control(boss.conn, { controlId: 'h', action: 'hammer', args: { closeNow: 1 } });
    await service.idle();
    rig.clock.set(START + 10_000);
    await vi.waitFor(async () => {
      expect((await journalOf(rig, auctionId)).state).toBe('FAILED_NEEDS_REVIEW');
    });
    await service.idle();
    expect((await rig.stores.holds.get(a.holdId))?.status).toBe('HELD');

    const load = vi.spyOn(rig.stores.journals, 'load');
    const before = errors.length;
    for (let i = 0; i < 5; i++) {
      await service.resume();
      await service.idle();
    }
    // Only the resume passes read the journal; no settlement run was scheduled.
    expect(load).toHaveBeenCalledTimes(5);
    expect(errors).toHaveLength(before);
    await service.close();
  });

  it('charges the hold the room registered and voids the bidder second hold (INT-R3-07)', async () => {
    const rig = await makeRig();
    const service = rig.service();
    const auctionId = rig.ids.mint<'AuctionId'>();
    const room = await service.createAuction(auctionId, config, 'auctioneer-sub');
    const a = await enroll(rig, service, room, auctionId, 'Ada', 50000);
    // A smaller hold approved later and never registered. The hold service refuses a second
    // hold for one bidder, so it is made for another id and stored under Ada's.
    const extra = await rig.holdsApi.createHoldOrder({
      auctionId,
      bidderId: rig.ids.mint<'BidderId'>(),
      ceilingCents: 30000,
      presetsCents: config.ceilingPresets,
    });
    rig.paypal.core.approveOrder(extra.orderId);
    await rig.holdsApi.completeApproval({ holdId: extra.holdId, orderId: extra.orderId });
    const made = await rig.stores.holds.get(extra.holdId);
    if (made === null) throw new Error('no spare hold');
    const spare = { ...made, bidderId: a.id, createdAtMs: made.createdAtMs + 1 };
    await rig.stores.holds.put(spare);

    await room.submitBid(a.conn, bid(rig, 35000));
    const boss = await connect(rig, room, 'auctioneer');
    await room.control(boss.conn, { controlId: 'h', action: 'hammer', args: { closeNow: 1 } });
    await service.idle();

    const run: Run = { auctionId, room, a, b: a, c: a, screen: new MemoryTransport() };
    await expectSettled(rig, run, a, [], 35000);
    expect(rig.paypal.core.getAuthorization(spare?.authId ?? '').status).toBe('VOIDED');
    expect((await rig.stores.holds.get(extra.holdId))?.status).toBe('VOIDED');
    await service.close();
  });
});

describe('auction service: leftover red-team round 3 (PAY-73)', () => {
  it('resumes after the engine already promoted past a skipped leader (PAYMENTS-R3-02)', async () => {
    const rig = await makeRig();
    let voidLeader: () => Promise<void> = async () => undefined;
    let crash = true;
    const service = rig.service({
      retryDelayMs: 3_600_000,
      resumeIntervalMs: 0,
      onError: () => undefined,
      boundary: async (label) => {
        // The leader's hold is lost between the hammer and the plan.
        if (label === 'before:settle') await voidLeader();
        if (label === 'after:prepare' && crash) {
          crash = false;
          throw new Error('process died');
        }
      },
    });
    const auctionId = rig.ids.mint<'AuctionId'>();
    const room = await service.createAuction(auctionId, config, 'auctioneer-sub');
    const a = await enroll(rig, service, room, auctionId, 'Ada', 50000);
    const d = await enroll(rig, service, room, auctionId, 'Di', 50000);
    await room.submitBid(a.conn, bid(rig, 10000));
    await room.submitBid(d.conn, bid(rig, 11000));
    voidLeader = async () => {
      const hold = await rig.stores.holds.get(d.holdId);
      if (hold !== null) await rig.stores.holds.put({ ...hold, status: 'VOIDED' });
    };
    const boss = await connect(rig, room, 'auctioneer');
    await room.control(boss.conn, { controlId: 'h', action: 'hammer', args: { closeNow: 1 } });
    await service.idle();
    expect(await rig.stores.journals.load(auctionId)).toBeNull();
    await service.resume();
    await service.idle();
    const run: Run = { auctionId, room, a, b: d, c: d, screen: new MemoryTransport() };
    await expectSettled(rig, run, a, [], 10000);
    await service.close();
  });

  it('does not share the saga lease with another instance (PAYMENTS-R3-10)', async () => {
    const rig = await makeRig();
    let taken = false;
    const service = rig.service({
      retryDelayMs: 5,
      retryMaxDelayMs: 20,
      resumeIntervalMs: 0,
      boundary: async (label) => {
        // Another instance, named the way every instance used to be, holds the lease.
        if (label === 'after:create-settlement' && !taken) {
          taken = true;
          const id = [...(await rig.stores.store.listAuctions())][0] ?? '';
          await rig.stores.journals.acquireLease(id, 'service', 600_000, rig.clock.now());
        }
      },
    });
    const run = await runToHammer(rig, service);
    await service.idle();
    await new Promise((r) => setTimeout(r, 60));
    expect(rig.paypal.core.getAuthorization(run.a.authId).captures).toHaveLength(0);
    await rig.stores.journals.releaseLease(run.auctionId, 'service');
    await vi.waitFor(async () => {
      expect((await journalOf(rig, run.auctionId)).state).toBe('SETTLED');
    });
    await service.idle();
    await expectSettled(rig, run, run.a, [run.b, run.c], 13000);
    await service.close();
  });

  it('exposes reconcile on the service (PAYMENTS-R3-12)', async () => {
    const rig = await makeRig();
    const service = rig.service();
    const run = await runToHammer(rig, service);
    await service.idle();
    await expectSettled(rig, run, run.a, [run.b, run.c], 13000);
    const report = await service.reconcile(run.auctionId);
    expect(report.journalState).toBe('SETTLED');
    await service.close();
  });

  /** A buyer who finishes the PayPal popup after the hammer: a live hold the plan never saw. */
  async function lateHold(
    rig: Rig,
    auctionId: AuctionId,
  ): Promise<{ holdId: string; authId: string; bidderId: BidderId }> {
    const bidderId = rig.ids.mint<'BidderId'>();
    const created = await rig.holdsApi.createHoldOrder({
      auctionId,
      bidderId,
      ceilingCents: 30000,
      presetsCents: config.ceilingPresets,
    });
    rig.paypal.core.approveOrder(created.orderId);
    await rig.holdsApi.completeApproval({ holdId: created.holdId, orderId: created.orderId });
    const held = await rig.stores.holds.get(created.holdId);
    expect(held?.status).toBe('HELD');
    return { holdId: created.holdId, authId: held?.authId ?? '', bidderId };
  }

  it('voids an authorization approved after the settlement ended when registration is refused (PAYMENTS-R3-09)', async () => {
    const rig = await makeRig();
    const service = rig.service({ resumeIntervalMs: 0 });
    const run = await runToHammer(rig, service);
    await service.idle();
    expect(await service.acceptsHolds(run.auctionId)).toBe(false);
    const late = await lateHold(rig, run.auctionId);
    expect(rig.paypal.core.getAuthorization(late.authId).status).not.toBe('VOIDED');
    await expect(
      service.registerBidder({
        auctionId: run.auctionId,
        bidderId: late.bidderId,
        name: 'Late',
        holdId: late.holdId,
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(rig.paypal.core.getAuthorization(late.authId).status).toBe('VOIDED');
    expect((await rig.stores.holds.get(late.holdId))?.status).toBe('VOIDED');
    await service.close();
  });

  it('voids a late authorization on resume even when nobody registers it (SERVICE-R3-09)', async () => {
    const rig = await makeRig();
    const service = rig.service({ resumeIntervalMs: 0 });
    const run = await runToHammer(rig, service);
    await service.idle();
    const late = await lateHold(rig, run.auctionId);
    await service.resume();
    await service.idle();
    expect(rig.paypal.core.getAuthorization(late.authId).status).toBe('VOIDED');
    await service.close();
  });

  it('accepts holds until the hammer (SERVICE-R3-09)', async () => {
    const rig = await makeRig();
    const service = rig.service({ resumeIntervalMs: 0 });
    const auctionId = rig.ids.mint<'AuctionId'>();
    await service.createAuction(auctionId, config, 'auctioneer-sub');
    expect(await service.acceptsHolds(auctionId)).toBe(true);
    await service.close();
  });
});

describe('auction service: void phase of the payments package (PAYMENTS-R3-03)', () => {
  // R4-S01 (#1209): a void that fails with an unknown outcome (5xx, timeout) is retried free of the
  // resume budget. The older R3-03 expectation (FAILED_NEEDS_REVIEW after maxVoidResumes) only holds
  // for a definite refusal, which the fake PayPal cannot produce on a void; that case is covered in
  // packages/payments/test/saga. So the service must keep VOIDING and recover once the outage ends.
  it('keeps retrying voids through a long outage without using the resume budget', async () => {
    const rig = await makeRig();
    const service = rig.service({
      retryDelayMs: 3_600_000,
      resumeIntervalMs: 0,
      maxVoidResumes: 1,
      onError: () => undefined,
    });
    const run = await runToHammer(rig, service, (bidders) => {
      for (const b of bidders.slice(1)) rig.paypal.core.inject('void', 'http_500', b.authId, 7);
    });
    await service.idle();
    expect((await journalOf(rig, run.auctionId)).state).toBe('VOIDING');
    for (let i = 0; i < 5; i++) {
      await service.resume();
      await service.idle();
    }
    const mid = await journalOf(rig, run.auctionId);
    expect(mid.state).not.toBe('FAILED_NEEDS_REVIEW');
    expect(mid.resumes).toBe(0);
    for (let i = 0; i < 6 && (await journalOf(rig, run.auctionId)).state !== 'SETTLED'; i++) {
      await service.resume();
      await service.idle();
    }
    expect((await journalOf(rig, run.auctionId)).state).toBe('SETTLED');
    expect(rig.paypal.core.getAuthorization(run.a.authId).captures).toHaveLength(1);
    await service.close();
  });
});

describe('auction service: red-team round 4 (RT-01)', () => {
  it('keeps a bidder whose registered hold is good when a spare hold is voided (R4-V01)', async () => {
    const rig = await makeRig();
    const service = rig.service();
    const auctionId = rig.ids.mint<'AuctionId'>();
    const room = await service.createAuction(auctionId, config, 'auctioneer-sub');
    const a = await enroll(rig, service, room, auctionId, 'Ada', 50000);
    // A second hold approved later and never registered, stored under Ada's id.
    const extra = await rig.holdsApi.createHoldOrder({
      auctionId,
      bidderId: rig.ids.mint<'BidderId'>(),
      ceilingCents: 30000,
      presetsCents: config.ceilingPresets,
    });
    rig.paypal.core.approveOrder(extra.orderId);
    await rig.holdsApi.completeApproval({ holdId: extra.holdId, orderId: extra.orderId });
    const made = await rig.stores.holds.get(extra.holdId);
    if (made === null) throw new Error('no spare hold');
    await rig.stores.holds.put({ ...made, bidderId: a.id, createdAtMs: made.createdAtMs + 1 });
    await room.submitBid(a.conn, bid(rig, 10000));

    rig.paypal.core.void(made.authId ?? '');
    await deliverVoids(rig, service, 0);

    expect(room.activeEngine?.view()).toMatchObject({ leader: a.id, price: 10000 });
    expect((await events(rig, auctionId)).map((e) => e.type)).not.toContain('ceiling_revoked');
    expect(await ledgerTypes(rig, auctionId)).not.toContain('CEILING_REVOKED');
    await service.close();
  });

  it('stops serving a room that another host won (R4-V02)', async () => {
    const rig = await makeRig();
    const hostA = rig.service({ resumeIntervalMs: 0 });
    const hostB = rig.service({ resumeIntervalMs: 0, onError: () => undefined });
    const auctionId = rig.ids.mint<'AuctionId'>();
    const roomA = await hostA.createAuction(auctionId, config, 'auctioneer-sub');
    const a = await enroll(rig, hostA, roomA, auctionId, 'Ada', 50000);
    const roomB = await hostB.room(auctionId);
    const viewer = await connect(rig, roomB, 'bidder', a.id);
    // Host A moves the log on; host B is behind and loses its next append.
    await roomA.submitBid(a.conn, bid(rig, 10000));
    await roomB.submitBid(viewer.conn, bid(rig, 10500));

    await vi.waitFor(() => expect(roomB.isStopped).toBe(true));
    await expect(hostB.room(auctionId)).rejects.toMatchObject({ code: 'host_fenced' });
    await hostB.resume();
    expect(roomA.isStopped).toBe(false);
    await hostA.close();
    await hostB.close();
  });

  it('does not repeat the bridge and reconcile for a finished settlement (R4-V04)', async () => {
    const rig = await makeRig();
    const reports: ReconcileReport[] = [];
    const service = rig.service({ resumeIntervalMs: 0, onReconcile: (r) => void reports.push(r) });
    const run = await runToHammer(rig, service);
    await service.idle();
    await expectSettled(rig, run, run.a, [run.b, run.c], 13000);
    const before = reports.length;
    expect(before).toBeGreaterThan(0);

    await service.resume();
    await service.idle();
    await service.resume();
    await service.idle();
    expect(reports).toHaveLength(before);
    await service.close();
  });

  it('voids live holds without a journal (R4-V03)', async () => {
    const rig = await makeRig();
    const auctionId = rig.ids.mint<'AuctionId'>();
    const created = await rig.holdsApi.createHoldOrder({
      auctionId,
      bidderId: rig.ids.mint<'BidderId'>(),
      ceilingCents: 30000,
      presetsCents: config.ceilingPresets,
    });
    rig.paypal.core.approveOrder(created.orderId);
    await rig.holdsApi.completeApproval({ holdId: created.holdId, orderId: created.orderId });
    const hold = await rig.stores.holds.get(created.holdId);
    expect(hold?.status).toBe('HELD');

    const open = await voidSpareHolds(spareDeps(rig), { auctionId }, new Set<string>());

    expect(open).toBe(0);
    expect((await rig.stores.holds.get(created.holdId))?.status).toBe('VOIDED');
    expect(rig.paypal.core.getAuthorization(hold?.authId ?? '').status).toBe('VOIDED');
    // RT4-saga-04: the void is a money call and has its own audit row.
    expect(
      rig.audits.filter(
        (a) => a.kind === 'paypal_call' && a.op === 'void' && a.holdId === created.holdId,
      ),
    ).toEqual([
      expect.objectContaining({ auctionId, outcome: 'definite', label: 'ok', attempt: 1 }),
    ]);
  });

  it('keeps a hold open when a 404 void is not backed by the authorization read (R5-S02)', async () => {
    const rig = await makeRig();
    const auctionId = rig.ids.mint<'AuctionId'>();
    const created = await rig.holdsApi.createHoldOrder({
      auctionId,
      bidderId: rig.ids.mint<'BidderId'>(),
      ceilingCents: 30000,
      presetsCents: config.ceilingPresets,
    });
    rig.paypal.core.approveOrder(created.orderId);
    await rig.holdsApi.completeApproval({ holdId: created.holdId, orderId: created.orderId });
    const refusing = {
      voidAuthorization: async (): Promise<never> => {
        throw new PayPalError({
          kind: 'not_found',
          status: 404,
          name: 'not_found',
          message: 'not found',
          outcome: 'definite',
        });
      },
      getHoldTruth: (h: { holdId: string; authId: string }) => rig.gateway.getHoldTruth(h),
    } as unknown as typeof rig.gateway;

    const open = await voidSpareHolds(
      { ...spareDeps(rig), gateway: refusing },
      { auctionId },
      new Set<string>(),
    );

    expect(open).toBe(1);
    expect((await rig.stores.holds.get(created.holdId))?.status).toBe('HELD');
  });

  it('keeps a hold open when the authorization read answers NOT_FOUND (HRD-46)', async () => {
    const rig = await makeRig();
    const auctionId = rig.ids.mint<'AuctionId'>();
    const created = await rig.holdsApi.createHoldOrder({
      auctionId,
      bidderId: rig.ids.mint<'BidderId'>(),
      ceilingCents: 30000,
      presetsCents: config.ceilingPresets,
    });
    rig.paypal.core.approveOrder(created.orderId);
    await rig.holdsApi.completeApproval({ holdId: created.holdId, orderId: created.orderId });
    const missing = {
      voidAuthorization: async (): Promise<never> => {
        throw new PayPalError({
          kind: 'not_found',
          status: 404,
          name: 'not_found',
          message: 'not found',
          outcome: 'definite',
        });
      },
      getHoldTruth: async (h: { holdId: string; authId: string }) => ({
        holdId: h.holdId,
        authId: h.authId,
        status: 'NOT_FOUND' as const,
        amountCents: 0,
        capturedCents: 0,
        captures: [],
        observedAtMs: 0,
      }),
    } as unknown as typeof rig.gateway;

    const open = await voidSpareHolds(
      { ...spareDeps(rig), gateway: missing },
      { auctionId },
      new Set<string>(),
    );

    expect(open).toBe(1);
    expect((await rig.stores.holds.get(created.holdId))?.status).toBe('HELD');
  });
});

describe('auction service: orphan hold when registration is refused (HRD-10, issue 704)', () => {
  async function approvedBelowReserve(rig: Rig, auctionId: AuctionId) {
    const bidderId = rig.ids.mint<'BidderId'>();
    const created = await rig.holdsApi.createHoldOrder({
      auctionId,
      bidderId,
      ceilingCents: 5000,
      presetsCents: [5000],
    });
    rig.paypal.core.approveOrder(created.orderId);
    await rig.holdsApi.completeApproval({ holdId: created.holdId, orderId: created.orderId });
    const held = await rig.stores.holds.get(created.holdId);
    return { bidderId, holdId: created.holdId, authId: held?.authId ?? '' };
  }

  it('voids the hold and audits the void when the engine refuses the ceiling', async () => {
    const rig = await makeRig();
    const service = rig.service({ resumeIntervalMs: 0 });
    const auctionId = rig.ids.mint<'AuctionId'>();
    await service.createAuction(auctionId, config, 'auctioneer-sub');
    const orphan = await approvedBelowReserve(rig, auctionId);
    expect(rig.paypal.core.getAuthorization(orphan.authId).status).not.toBe('VOIDED');
    await expect(
      service.registerBidder({
        auctionId,
        bidderId: orphan.bidderId,
        name: 'Low',
        holdId: orphan.holdId,
      }),
    ).rejects.toMatchObject({ code: 'bad_message' });
    expect(rig.paypal.core.getAuthorization(orphan.authId).status).toBe('VOIDED');
    expect((await rig.stores.holds.get(orphan.holdId))?.status).toBe('VOIDED');
    const voids = rig.audits.filter(
      (a) => a.kind === 'paypal_call' && a.op === 'void' && a.holdId === orphan.holdId,
    );
    expect(voids).toHaveLength(1);
    await service.close();
  });

  it('is idempotent: a retry of the refused registration sends no second void', async () => {
    const rig = await makeRig();
    const service = rig.service({ resumeIntervalMs: 0 });
    const auctionId = rig.ids.mint<'AuctionId'>();
    await service.createAuction(auctionId, config, 'auctioneer-sub');
    const orphan = await approvedBelowReserve(rig, auctionId);
    const input = { auctionId, bidderId: orphan.bidderId, name: 'Low', holdId: orphan.holdId };
    await expect(service.registerBidder(input)).rejects.toMatchObject({ code: 'bad_message' });
    await expect(service.registerBidder(input)).rejects.toMatchObject({ code: 'forbidden' });
    const voids = rig.audits.filter(
      (a) => a.kind === 'paypal_call' && a.op === 'void' && a.holdId === orphan.holdId,
    );
    expect(voids).toHaveLength(1);
    expect(rig.paypal.core.getAuthorization(orphan.authId).status).toBe('VOIDED');
    await service.close();
  });

  it('keeps the hold of a bidder whose registration succeeds', async () => {
    const rig = await makeRig();
    const service = rig.service({ resumeIntervalMs: 0 });
    const auctionId = rig.ids.mint<'AuctionId'>();
    const room = await service.createAuction(auctionId, config, 'auctioneer-sub');
    const ok = await enroll(rig, service, room, auctionId, 'Ada', 30000);
    expect((await rig.stores.holds.get(ok.holdId))?.status).toBe('HELD');
    expect(rig.paypal.core.getAuthorization(ok.authId).status).not.toBe('VOIDED');
    await service.close();
  });
});

describe('auction service: HRD-16 hold recovery wiring', () => {
  it('adopts an authorization left by a crash before the HELD write, on the sweep', async () => {
    const rig = await makeRig();
    const service = rig.service({ resumeIntervalMs: 0, holdSweepMinAgeMs: 60_000 });
    const auctionId = rig.ids.mint<'AuctionId'>();
    await service.createAuction(auctionId, config, 'auctioneer-sub');
    const created = await rig.holdsApi.createHoldOrder({
      auctionId,
      bidderId: rig.ids.mint<'BidderId'>(),
      ceilingCents: 30000,
      presetsCents: config.ceilingPresets,
    });
    rig.paypal.core.approveOrder(created.orderId);
    // PayPal authorizes; the process dies before the record learns the authorization id.
    const lost = await rig.gateway.authorizeOrder(created.orderId, 'req-lost');
    await service.resume();
    expect((await rig.stores.holds.get(created.holdId))?.authId).toBeUndefined();
    rig.clock.advance(120_000);
    await service.resume();
    const rec = await rig.stores.holds.get(created.holdId);
    expect(rec).toMatchObject({ status: 'HELD', authId: lost.authId });
    await service.close();
  });

  it('voids a second hold of a registered bidder and retries a failed void on the sweep', async () => {
    const rig = await makeRig();
    const service = rig.service({ resumeIntervalMs: 0 });
    const auctionId = rig.ids.mint<'AuctionId'>();
    const room = await service.createAuction(auctionId, config, 'auctioneer-sub');
    const first = await enroll(rig, service, room, auctionId, 'Ada', 30000);
    const other = rig.ids.mint<'BidderId'>();
    const spare = await rig.holdsApi.createHoldOrder({
      auctionId,
      bidderId: other,
      ceilingCents: 30000,
      presetsCents: config.ceilingPresets,
    });
    rig.paypal.core.approveOrder(spare.orderId);
    await rig.holdsApi.completeApproval({ holdId: spare.holdId, orderId: spare.orderId });
    const held = await rig.stores.holds.get(spare.holdId);
    if (held?.authId === undefined) throw new Error('spare hold not authorized');
    await rig.stores.holds.put({ ...held, bidderId: first.id });
    rig.paypal.core.inject('void', 'http_500', held.authId, 7);
    await expect(
      service.registerBidder({
        auctionId,
        bidderId: first.id,
        name: 'Ada',
        holdId: spare.holdId,
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    for (let i = 0; i < 4; i += 1) {
      if ((await rig.stores.holds.get(spare.holdId))?.status === 'VOIDED') break;
      await service.resume();
    }
    expect((await rig.stores.holds.get(spare.holdId))?.status).toBe('VOIDED');
    expect(rig.paypal.core.getAuthorization(held.authId).status).toBe('VOIDED');
    expect((await rig.stores.holds.get(first.holdId))?.status).toBe('HELD');
    await service.close();
  });
});

describe('auction service: resume keeps a room a client just asked for (#1749)', () => {
  it('does not unload a finished room under a joining socket', async () => {
    const rig = await makeRig();
    const service = rig.service({ resumeIntervalMs: 0 });
    const id = rig.ids.mint<'AuctionId'>();
    const room = await service.createAuction(id, config, 'auctioneer-sub');
    const boss = await connect(rig, room, 'auctioneer');
    await room.control(boss.conn, { controlId: 'h', action: 'hammer', args: { closeNow: 1 } });
    await service.idle();
    room.detach(boss.conn.id);
    await service.resume();
    expect(service.stats().rooms).toBe(0);
    // A viewer asks for the room; the attach has not run yet when the next pass starts.
    await service.room(id);
    expect(service.stats().rooms).toBe(1);
    await service.resume();
    expect(service.stats().rooms).toBe(1);
    rig.clock.set(START + 60_000);
    await service.resume();
    expect(service.stats().rooms).toBe(0);
    await service.close();
  });
});

describe('auction service: payments wiring (HRD-52)', () => {
  it('flags a stale hold on its record when the settlement starts (issue 1725)', async () => {
    const rig = await makeRig();
    const service = rig.service({ resumeIntervalMs: 0, holdMaxAgeMs: 60_000 });
    const auctionId = rig.ids.mint<'AuctionId'>();
    const room = await service.createAuction(auctionId, config, 'auctioneer-sub');
    const a = await enroll(rig, service, room, auctionId, 'Ada', 50000);
    const b = await enroll(rig, service, room, auctionId, 'Bo', 30000);
    const boss = await connect(rig, room, 'auctioneer');
    await room.submitBid(a.conn, bid(rig, 10000));
    await room.submitBid(b.conn, bid(rig, 10500));
    rig.clock.advance(120_000);
    await room.control(boss.conn, {
      controlId: 'hammer-1',
      action: 'hammer',
      args: { closeNow: 1 },
    });
    await service.idle();
    expect((await rig.stores.holds.get(a.holdId))?.stale).toBe(true);
    expect(rig.audits.some((e) => e.kind === 'stale_hold' && e.holdId === a.holdId)).toBe(true);
    await service.close();
  });

  it('reauthorizes an old hold once before the capture when the policy is on (issue 1725)', async () => {
    const rig = await makeRig();
    const service = rig.service({
      resumeIntervalMs: 0,
      reauthPolicy: { enabled: true, honorSafeMs: 60_000 },
    });
    const auctionId = rig.ids.mint<'AuctionId'>();
    const room = await service.createAuction(auctionId, config, 'auctioneer-sub');
    const a = await enroll(rig, service, room, auctionId, 'Ada', 50000);
    const b = await enroll(rig, service, room, auctionId, 'Bo', 30000);
    const boss = await connect(rig, room, 'auctioneer');
    await room.submitBid(a.conn, bid(rig, 10000));
    await room.submitBid(b.conn, bid(rig, 10500));
    rig.clock.advance(120_000);
    await room.control(boss.conn, {
      controlId: 'hammer-1',
      action: 'hammer',
      args: { closeNow: 1 },
    });
    await service.idle();
    const reauths = rig.audits.filter((e) => e.kind === 'paypal_call' && e.op === 'reauth');
    expect(reauths.length).toBeGreaterThan(0);
    expect((await journalOf(rig, auctionId)).state).toBe('SETTLED');
    await service.close();
  });

  it('does not reauthorize while the policy is off (issue 1725)', async () => {
    const rig = await makeRig();
    const service = rig.service({ resumeIntervalMs: 0 });
    const run = await runToHammer(rig, service);
    await service.idle();
    expect(run.auctionId).toBeDefined();
    expect(rig.audits.some((e) => e.op === 'reauth')).toBe(false);
    await service.close();
  });

  it('runs the periodic reconcile over settled auctions when it is on (issue 1724)', async () => {
    const rig = await makeRig();
    const reports: ReconcileReport[] = [];
    const service = rig.service({
      resumeIntervalMs: 0,
      reconcileIntervalMs: 20,
      onReconcile: (r) => void reports.push(r),
    });
    const run = await runToHammer(rig, service);
    await service.idle();
    await expectSettled(rig, run, run.a, [run.b, run.c], 13000);
    await new Promise((r) => setTimeout(r, 300));
    const afterSettle = reports.length;
    expect(afterSettle).toBeGreaterThan(1);
    await service.close();
    // A pass already running when the service closed may still report; no new one starts.
    await new Promise((r) => setTimeout(r, 100));
    const stopped = reports.length;
    await new Promise((r) => setTimeout(r, 150));
    expect(reports.length).toBe(stopped);
  });

  it('does not start the periodic reconcile by default (issue 1724)', async () => {
    const rig = await makeRig();
    const reports: ReconcileReport[] = [];
    const service = rig.service({ resumeIntervalMs: 0, onReconcile: (r) => void reports.push(r) });
    const run = await runToHammer(rig, service);
    await service.idle();
    await expectSettled(rig, run, run.a, [run.b, run.c], 13000);
    const before = reports.length;
    await new Promise((r) => setTimeout(r, 200));
    expect(reports.length).toBe(before);
    await service.close();
  });
});

describe('auction service: reauthorization and reconcile safety (HRD-52 review)', () => {
  const DAY_MS = 86_400_000;
  const reauthPolicy = { enabled: true, honorSafeMs: 60_000 };
  const reauthCalls = (rig: Rig): PaymentAudit[] =>
    rig.audits.filter((e) => e.kind === 'paypal_call' && e.op === 'reauth');

  /**
   * Moves PayPal's clock past the honor period of the holds made so far, then makes one read
   * so the OAuth token the jump expired is renewed before any fault is armed.
   */
  async function pastHonor(rig: Rig, hold: Bidder): Promise<void> {
    rig.paypal.core.clock.advance(4 * DAY_MS);
    await rig.gateway.getHoldTruth({ holdId: hold.holdId, authId: hold.authId });
  }

  /** A buyer of the lot approves a hold after it settled: a live hold nobody else releases. */
  async function strayHold(rig: Rig, auctionId: AuctionId): Promise<{ authId: string }> {
    const created = await rig.holdsApi.createHoldOrder({
      auctionId,
      bidderId: rig.ids.mint<'BidderId'>(),
      ceilingCents: 30000,
      presetsCents: config.ceilingPresets,
    });
    rig.paypal.core.approveOrder(created.orderId);
    await rig.holdsApi.completeApproval({ holdId: created.holdId, orderId: created.orderId });
    return { authId: (await rig.stores.holds.get(created.holdId))?.authId ?? '' };
  }

  it('runs no capture or void while a reauthorization outcome is unknown', async () => {
    const rig = await makeRig();
    const service = rig.service({
      resumeIntervalMs: 0,
      retryDelayMs: 3_600_000,
      onError: () => undefined,
      reauthPolicy,
    });
    const auctionId = rig.ids.mint<'AuctionId'>();
    const room = await service.createAuction(auctionId, config, 'auctioneer-sub');
    const a = await enroll(rig, service, room, auctionId, 'Ada', 50000);
    const b = await enroll(rig, service, room, auctionId, 'Bo', 30000);
    const core = rig.paypal.core;
    // PayPal's honor period has passed. It reauthorizes Ada's hold, so her old authorization is
    // closed (A11), but every answer is lost on the way back.
    await pastHonor(rig, a);
    rig.paypal.faults.add({
      kind: 'timeout_after_success',
      op: 'reauthorize',
      authId: a.authId,
      times: 100_000,
    });
    await room.submitBid(b.conn, bid(rig, 10000));
    await room.submitBid(a.conn, bid(rig, 11000));
    rig.clock.advance(120_000);
    const boss = await connect(rig, room, 'auctioneer');
    await room.control(boss.conn, { controlId: 'h', action: 'hammer', args: { closeNow: 1 } });
    await service.idle();

    // The capture waits: Ada is not failed on her closed authorization and Bo is not charged.
    expect(core.calls.filter((c) => c.op === 'capture' || c.op === 'void')).toEqual([]);
    const waiting = await journalOf(rig, auctionId);
    expect(waiting.winner).toBeNull();
    expect(waiting.failed).toEqual([]);
    expect(core.getAuthorization(a.authId).status).toBe('VOIDED');

    // The answers come back: the same request id replays the reauthorization and Ada is
    // charged on the authorization PayPal holds her funds under.
    rig.paypal.faults.clear();
    await service.resume();
    await service.idle();
    const settled = await journalOf(rig, auctionId);
    expect(settled.state).toBe('SETTLED');
    expect(settled.winner).toMatchObject({ bidderId: a.id, amountCents: 11000 });
    const adaNow = settled.holds[a.id]?.authId ?? '';
    const boNow = settled.holds[b.id]?.authId ?? '';
    expect(adaNow).not.toBe(a.authId);
    expect(core.getAuthorization(adaNow).capturedCents).toBe(11000);
    expect(core.getAuthorization(a.authId).captures).toHaveLength(0);
    expect(core.getAuthorization(boNow).status).toBe('VOIDED');
    expect(core.getAuthorization(boNow).captures).toHaveLength(0);
    expect(core.getAuthorization(b.authId).captures).toHaveLength(0);
    core.checkInvariants();
    await service.close();
  });

  it('sends the lot to review when a reauthorization stays unknown', async () => {
    const rig = await makeRig();
    const errors: unknown[] = [];
    const service = rig.service({
      resumeIntervalMs: 0,
      retryDelayMs: 5,
      retryMaxDelayMs: 10,
      onError: (_id, e) => errors.push(e),
      reauthPolicy,
    });
    const auctionId = rig.ids.mint<'AuctionId'>();
    const room = await service.createAuction(auctionId, config, 'auctioneer-sub');
    const a = await enroll(rig, service, room, auctionId, 'Ada', 50000);
    const b = await enroll(rig, service, room, auctionId, 'Bo', 30000);
    await pastHonor(rig, a);
    rig.paypal.faults.add({
      kind: 'timeout_after_success',
      op: 'reauthorize',
      authId: a.authId,
      times: 100_000,
    });
    await room.submitBid(b.conn, bid(rig, 10000));
    await room.submitBid(a.conn, bid(rig, 11000));
    rig.clock.advance(120_000);
    const boss = await connect(rig, room, 'auctioneer');
    await room.control(boss.conn, { controlId: 'h', action: 'hammer', args: { closeNow: 1 } });
    await vi.waitFor(
      async () => expect((await journalOf(rig, auctionId)).state).toBe('FAILED_NEEDS_REVIEW'),
      { timeout: 10_000 },
    );
    await service.idle();
    const review = await journalOf(rig, auctionId);
    expect(review.history.at(-1)?.label).toBe('journaled:reauth_unknown');
    expect(reauthCalls(rig).filter((e) => e.holdId === a.holdId)).toHaveLength(5);
    expect(rig.paypal.core.calls.filter((c) => c.op === 'capture')).toEqual([]);
    expect(errors.some((e) => e instanceof Error && /stayed unknown/.test(e.message))).toBe(true);
    await service.close();
  });

  it('reauthorizes only the candidates still in play, and only before a capture', async () => {
    const rig = await makeRig();
    const service = rig.service({
      resumeIntervalMs: 0,
      retryDelayMs: 3_600_000,
      onError: () => undefined,
      reauthPolicy,
    });
    const auctionId = rig.ids.mint<'AuctionId'>();
    const room = await service.createAuction(auctionId, config, 'auctioneer-sub');
    const a = await enroll(rig, service, room, auctionId, 'Ada', 50000);
    const b = await enroll(rig, service, room, auctionId, 'Bo', 30000);
    // Ada's and Bo's holds are past PayPal's honor period. Cy's is new there, so PayPal
    // refuses to reauthorize it. Di registers and never bids.
    await pastHonor(rig, a);
    const c = await enroll(rig, service, room, auctionId, 'Cy', 30000);
    const d = await enroll(rig, service, room, auctionId, 'Di', 30000);
    // Di's release stays unconfirmed, so the settlement is still VOIDING after the capture.
    rig.paypal.faults.add({ kind: 'http_500', op: 'void', authId: d.authId, times: 100_000 });
    await room.submitBid(b.conn, bid(rig, 10000));
    await room.submitBid(c.conn, bid(rig, 10500));
    await room.submitBid(a.conn, bid(rig, 11000));
    rig.clock.advance(120_000);
    const boss = await connect(rig, room, 'auctioneer');
    await room.control(boss.conn, { controlId: 'h', action: 'hammer', args: { closeNow: 1 } });
    await service.idle();

    const journal = await journalOf(rig, auctionId);
    expect(journal.state).toBe('VOIDING');
    expect(journal.winner).toMatchObject({ bidderId: a.id, amountCents: 11000 });
    const first = reauthCalls(rig).map((e) => e.holdId);
    expect([...first].sort()).toEqual([a.holdId, b.holdId, c.holdId].sort());

    // A pass after the capture reauthorizes nothing, not even the hold PayPal refused.
    await service.resume();
    await service.idle();
    expect((await journalOf(rig, auctionId)).state).toBe('VOIDING');
    expect(reauthCalls(rig)).toHaveLength(first.length);
    expect(rig.paypal.core.getAuthorization(d.authId).status).toBe('CREATED');
    await service.close();
  });

  it('repairs only a stray live hold of a lot settled within the look-back', async () => {
    const rig = await makeRig();
    const service = rig.service({
      resumeIntervalMs: 0,
      reconcileIntervalMs: 20,
      reconcileRepair: true,
    });
    const run = await runToHammer(rig, service);
    await service.idle();
    await expectSettled(rig, run, run.a, [run.b, run.c], 13000);
    const core = rig.paypal.core;
    const settledCalls = core.calls.length;

    const stray = await strayHold(rig, run.auctionId);
    await vi.waitFor(() => {
      const voids = core.calls.slice(settledCalls).filter((c) => c.op === 'void');
      expect(voids.map((c) => c.id)).toEqual([stray.authId]);
    });
    expect(core.getAuthorization(stray.authId).status).toBe('VOIDED');
    expect(core.getAuthorization(run.a.authId).capturedCents).toBe(13000);

    // A day later the lot is outside the look-back: the pass reads nothing at PayPal for it,
    // so a hold approved now is left to the resume pass.
    rig.clock.advance(25 * 3_600_000);
    await new Promise((r) => setTimeout(r, 100));
    const late = await strayHold(rig, run.auctionId);
    const before = core.calls.length;
    await new Promise((r) => setTimeout(r, 200));
    expect(core.calls.slice(before)).toEqual([]);
    expect(core.getAuthorization(late.authId).status).toBe('CREATED');
    await service.close();
  });
});
