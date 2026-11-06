import { InMemoryLedgerStore } from '@gavel/engine';
import {
  HoldService,
  MemoryHoldStore,
  MemoryJournalStore,
  MemoryKillStateStore,
  MemoryWebhookEventStore,
  PayPalGateway,
  PersistentKillSwitch,
  TokenManager,
  Transport,
  WebhookVerifier,
  type PaymentAudit,
} from '@gavel/payments';
import { DEFAULT_FAKE_WEBHOOK_ID, FakePayPalServer } from '@gavel/payments/fake';
import {
  ManualClock,
  SeqIds,
  serverSchemas,
  type AuctionConfig,
  type AuctionId,
  type BidderId,
  type ConnId,
} from '@gavel/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryTransport } from '../../src/room/memory-transport';
import type { Connection, Room } from '../../src/room/room';
import { MemoryStore } from '../../src/store/memory-store';
import { createAuctionService, type AuctionService } from '../../src/runtime/auction-service';

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

const stops: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const stop of stops.splice(0).reverse()) await stop();
});

async function rig() {
  const paypal = new FakePayPalServer({ timers: { sleep: noSleep } });
  await paypal.start();
  stops.push(() => paypal.stop());
  const auth = new TokenManager({
    transport: new Transport({ sleep: noSleep }),
    baseUrl: paypal.url,
    clientId: 'fake-client',
    clientSecret: 'fake-secret-value',
  });
  const clock = new ManualClock(START);
  const ids = new SeqIds();
  const audit = { append: async (_e: PaymentAudit): Promise<void> => undefined };
  const payClock = { nowMs: (): number => clock.now() };
  const gateway = new PayPalGateway({ auth, fake: true, clock: payClock });
  const holds = new MemoryHoldStore();
  let n = 0;
  const holdsApi = new HoldService({
    gateway,
    holds,
    audit,
    clock: payClock,
    maxCeilingCents: 100_000,
    newId: () => `HOLD-${(n += 1)}`,
  });
  const service = createAuctionService({
    store: new MemoryStore(() => clock.now()),
    ledger: new InMemoryLedgerStore(),
    journals: new MemoryJournalStore(),
    holds,
    webhookEvents: new MemoryWebhookEventStore(),
    clock,
    ids,
    audit,
    gateway,
    verifier: new WebhookVerifier({ auth, webhookId: DEFAULT_FAKE_WEBHOOK_ID, fake: true }),
    killSwitch: new PersistentKillSwitch({
      store: new MemoryKillStateStore(),
      audit,
      clock: payClock,
    }),
  });
  stops.push(() => service.close());
  return { paypal, ids, holdsApi, service };
}

type Rig = Awaited<ReturnType<typeof rig>>;

async function connect(
  r: Rig,
  room: Room,
  role: Connection['role'],
  bidderId?: BidderId,
): Promise<{ conn: Connection; transport: MemoryTransport }> {
  const transport = new MemoryTransport();
  const conn: Connection = {
    id: r.ids.mint<'ConnId'>() as ConnId,
    role,
    sub: bidderId ?? `${role}-sub`,
    transport,
    ...(bidderId ? { bidderId } : {}),
  };
  await room.attach(conn);
  return { conn, transport };
}

async function enroll(
  r: Rig,
  service: AuctionService,
  room: Room,
  auctionId: AuctionId,
  name: string,
  ceilingCents: number,
) {
  const id = r.ids.mint<'BidderId'>();
  const created = await r.holdsApi.createHoldOrder({
    auctionId,
    bidderId: id,
    ceilingCents,
    presetsCents: [30000, 50000],
  });
  r.paypal.core.approveOrder(created.orderId);
  await r.holdsApi.completeApproval({ holdId: created.holdId, orderId: created.orderId });
  await service.registerBidder({ auctionId, bidderId: id, name, holdId: created.holdId });
  return { id, holdId: created.holdId, ...(await connect(r, room, 'bidder', id)) };
}

const bid = (r: Rig, amount: number) => ({
  v: 1 as const,
  t: 'bid' as const,
  mid: r.ids.mint<'MsgId'>(),
  amount,
  source: 'qr' as const,
});

describe('settlement_update carries only the viewer own hold (HRD-69, issue 712)', () => {
  it('sends each bidder their own hold and everyone else public data only', async () => {
    const r = await rig();
    const auctionId = r.ids.mint<'AuctionId'>();
    const room = await r.service.createAuction(auctionId, config, 'auctioneer-sub');
    const a = await enroll(r, r.service, room, auctionId, 'Ada', 50000);
    const b = await enroll(r, r.service, room, auctionId, 'Bo', 30000);
    const screen = await connect(r, room, 'screen');
    const boss = await connect(r, room, 'auctioneer');
    await room.submitBid(a.conn, bid(r, 10000));
    await room.submitBid(b.conn, bid(r, 10500));
    await room.submitBid(a.conn, bid(r, 13000));
    await room.control(boss.conn, { controlId: 'h', action: 'hammer', args: { closeNow: 1 } });
    await r.service.idle();

    const updates = (t: MemoryTransport) => t.messages('settlement_update');
    // Every frame is a valid shared settlement_update.
    for (const t of [a.transport, b.transport, screen.transport, boss.transport]) {
      expect(updates(t).length).toBeGreaterThan(0);
      for (const f of updates(t))
        expect(serverSchemas.settlement_update.safeParse(f).success).toBe(true);
    }

    // The winner sees their capture and the released remainder, nothing about Bo.
    const mine = updates(a.transport).at(-1);
    expect(mine).toMatchObject({
      auctionState: 'SETTLED',
      winnerPaddle: 1,
      yourHold: {
        bidderId: a.id,
        idSuffix: 'HOLD-1',
        status: 'CAPTURED',
        ceilingCents: 50000,
        capturedCents: 13000,
        releasedCents: 37000,
        remainder: 'released',
      },
    });
    for (const f of updates(a.transport)) {
      expect(JSON.stringify(f)).not.toContain(b.id);
      expect(JSON.stringify(f)).not.toContain(b.holdId);
    }

    // The loser sees their own released hold, never the winner's ceiling or hold.
    expect(updates(b.transport).at(-1)).toMatchObject({
      winnerPaddle: 1,
      yourHold: {
        bidderId: b.id,
        status: 'VOIDED',
        ceilingCents: 30000,
        capturedCents: 0,
        releasedCents: 30000,
        remainder: 'none',
      },
    });
    for (const f of updates(b.transport)) {
      const text = JSON.stringify(f);
      expect(text).not.toContain(a.id);
      expect(text).not.toContain('50000');
      expect(text).not.toContain('37000');
    }

    // Screens and the auctioneer get the public outcome and no hold at all.
    for (const t of [screen.transport, boss.transport]) {
      for (const f of updates(t)) {
        expect(f).not.toHaveProperty('yourHold');
        expect(JSON.stringify(f)).not.toContain('ceilingCents');
      }
      expect(updates(t).at(-1)).toMatchObject({
        auctionState: 'SETTLED',
        amountCaptured: 13000,
        winnerPaddle: 1,
      });
    }
  });
});
