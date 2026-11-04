import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryLedgerStore, evolveAll, type Ulid } from '@gavel/engine';
import {
  HoldService,
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
import type { Connection, Room } from '../../src/room/room';
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
  const verifier = new WebhookVerifier({ auth, webhookId: DEFAULT_FAKE_WEBHOOK_ID });
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
  return { paypal, clock, ids, stores, audits, holdsApi, killSwitch, service };
}

type Rig = Awaited<ReturnType<typeof makeRig>>;

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
async function runToHammer(rig: Rig, service: AuctionService): Promise<Run> {
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

describe('auction service: bidder registration', () => {
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
    const service = rig.service();
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

describe('auction service: leftover red-team round 3 (PAY-71)', () => {
  it('resumes after the engine already promoted past a skipped leader (PAYMENTS-R3-02)', async () => {
    const rig = await makeRig();
    let voidLeader: () => Promise<void> = async () => undefined;
    let crash = true;
    const service = rig.service({
      retryBaseMs: 0,
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

  it('runs a settlement again after the kill switch is released (PAYMENTS-R3-05)', async () => {
    const rig = await makeRig();
    const service = rig.service({ retryBaseMs: 5, retryMaxMs: 20 });
    await rig.killSwitch.engage('operator stop', 'ops');
    const run = await runToHammer(rig, service);
    await service.idle();
    expect(rig.paypal.core.getAuthorization(run.a.authId).captures).toHaveLength(0);
    expect((await journalOf(rig, run.auctionId)).state).not.toBe('SETTLED');
    await rig.killSwitch.release('ops');
    await vi.waitFor(async () => {
      expect((await journalOf(rig, run.auctionId)).state).toBe('SETTLED');
    });
    await service.idle();
    await expectSettled(rig, run, run.a, [run.b, run.c], 13000);
    await service.close();
  });

  it('does not share the saga lease with another instance (PAYMENTS-R3-10)', async () => {
    const rig = await makeRig();
    let taken = false;
    const service = rig.service({
      retryBaseMs: 5,
      retryMaxMs: 20,
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
    const service = rig.service({ retryBaseMs: 0 });
    const run = await runToHammer(rig, service);
    await service.idle();
    await expectSettled(rig, run, run.a, [run.b, run.c], 13000);
    const report = await service.reconcile(run.auctionId);
    expect(report.journalState).toBe('SETTLED');
    await service.close();
  });

  it('voids an authorization approved after the plan was cut (PAYMENTS-R3-09, SERVICE-R3-09)', async () => {
    const rig = await makeRig();
    const service = rig.service({ retryBaseMs: 0 });
    const run = await runToHammer(rig, service);
    await service.idle();
    expect(await service.acceptsHolds(run.auctionId)).toBe(false);

    // The buyer finishes the PayPal popup after the hammer.
    const late = rig.ids.mint<'BidderId'>();
    const created = await rig.holdsApi.createHoldOrder({
      auctionId: run.auctionId,
      bidderId: late,
      ceilingCents: 30000,
      presetsCents: config.ceilingPresets,
    });
    rig.paypal.core.approveOrder(created.orderId);
    await rig.holdsApi.completeApproval({ holdId: created.holdId, orderId: created.orderId });
    const held = await rig.stores.holds.get(created.holdId);
    expect(held?.status).toBe('HELD');
    const authId = held?.authId ?? '';
    expect(rig.paypal.core.getAuthorization(authId).status).not.toBe('VOIDED');

    await expect(
      service.registerBidder({
        auctionId: run.auctionId,
        bidderId: late,
        name: 'Late',
        holdId: created.holdId,
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(rig.paypal.core.getAuthorization(authId).status).toBe('VOIDED');
    expect((await rig.stores.holds.get(created.holdId))?.status).toBe('VOIDED');
    await service.close();
  });

  it('voids a late authorization on resume even when nobody registers it (SERVICE-R3-09)', async () => {
    const rig = await makeRig();
    const service = rig.service({ retryBaseMs: 0 });
    const run = await runToHammer(rig, service);
    await service.idle();
    const late = rig.ids.mint<'BidderId'>();
    const created = await rig.holdsApi.createHoldOrder({
      auctionId: run.auctionId,
      bidderId: late,
      ceilingCents: 30000,
      presetsCents: config.ceilingPresets,
    });
    rig.paypal.core.approveOrder(created.orderId);
    await rig.holdsApi.completeApproval({ holdId: created.holdId, orderId: created.orderId });
    const authId = (await rig.stores.holds.get(created.holdId))?.authId ?? '';
    await service.resume();
    await service.idle();
    expect(rig.paypal.core.getAuthorization(authId).status).toBe('VOIDED');
    await service.close();
  });

  it('accepts holds until the hammer (SERVICE-R3-09)', async () => {
    const rig = await makeRig();
    const service = rig.service({ retryBaseMs: 0 });
    const auctionId = rig.ids.mint<'AuctionId'>();
    await service.createAuction(auctionId, config, 'auctioneer-sub');
    expect(await service.acceptsHolds(auctionId)).toBe(true);
    await service.close();
  });
});

describe('auction service: void phase of the payments package (PAYMENTS-R3-03)', () => {
  it('sends a settlement with a void that never works to review instead of pending forever', async () => {
    const rig = await makeRig();
    const errors: unknown[] = [];
    const service = rig.service({
      retryBaseMs: 0,
      maxVoidResumes: 1,
      onError: (_id, e) => errors.push(e),
    });
    rig.paypal.core.inject('void', 'http_500', null, 1000);
    const run = await runToHammer(rig, service);
    await service.idle();
    expect((await journalOf(rig, run.auctionId)).state).toBe('VOIDING');
    for (let i = 0; i < 5; i++) {
      await service.resume();
      await service.idle();
    }
    const journal = await journalOf(rig, run.auctionId);
    expect(journal.state).toBe('FAILED_NEEDS_REVIEW');
    // The winner was charged once, and the room hears that the result is under review.
    expect(rig.paypal.core.getAuthorization(run.a.authId).captures).toHaveLength(1);
    const last = (await events(rig, run.auctionId))
      .filter((e) => e.type === 'settlement_update')
      .at(-1);
    expect(last).toMatchObject({ auctionState: 'FAILED_NEEDS_REVIEW' });
    await service.close();
  });
});
