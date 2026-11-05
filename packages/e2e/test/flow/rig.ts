import { InMemoryLedgerStore, type LedgerStore, type Ulid } from '@gavel/engine';
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
  createAuctionService,
  type AuctionService,
  type AuctionServiceDeps,
  type Connection,
  type Room,
} from '@gavel/server';
import { MemoryTransport } from '@gavel/server/src/room/memory-transport';
import { MemoryStore } from '@gavel/server/src/store/memory-store';
import {
  ManualClock,
  SeqIds,
  type AuctionConfig,
  type AuctionId,
  type BidMsg,
  type BidderId,
  type ConnId,
} from '@gavel/shared';

export const START = 1_789_000_000_000;

export const CONFIG = {
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

const noSleep = async (): Promise<void> => undefined;

/** One fake PayPal server plus every store that has to outlive a restart of the service. */
export async function makeRig() {
  const paypal = new FakePayPalServer({ timers: { sleep: noSleep } });
  await paypal.start();
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
  const stores = {
    store: new MemoryStore(() => clock.now()),
    ledger: new InMemoryLedgerStore() as LedgerStore,
    journals: new MemoryJournalStore(),
    holds: new MemoryHoldStore(),
    webhookEvents: new MemoryWebhookEventStore(),
  };
  let holdCounter = 0;
  const holdsApi = new HoldService({
    gateway,
    holds: stores.holds,
    audit,
    clock: payClock,
    maxCeilingCents: 100_000,
    newId: () => `HOLD-${(holdCounter += 1)}`,
  });
  const verifier = new WebhookVerifier({ auth, webhookId: DEFAULT_FAKE_WEBHOOK_ID, fake: true });
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
  return { paypal, clock, ids, stores, holdsApi, service };
}

export type Rig = Awaited<ReturnType<typeof makeRig>>;

export interface Bidder {
  id: BidderId;
  name: string;
  holdId: string;
  authId: string;
  conn: Connection;
  transport: MemoryTransport;
}

export async function connect(
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

/** Creates a hold for the ceiling, approves it at the fake PayPal, registers and connects. */
export async function enroll(
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
    presetsCents: CONFIG.ceilingPresets,
  });
  rig.paypal.core.approveOrder(created.orderId);
  await rig.holdsApi.completeApproval({ holdId: created.holdId, orderId: created.orderId });
  await service.registerBidder({ auctionId, bidderId: id, name, holdId: created.holdId });
  const hold = await rig.stores.holds.get(created.holdId);
  const { conn, transport } = await connect(rig, room, 'bidder', id);
  return { id, name, holdId: created.holdId, authId: hold?.authId ?? '', conn, transport };
}

/** What a voice bid carries from the parser: the confidence is required so the gate is exercised. */
export interface VoiceFields {
  confidence: number;
  transcript: string;
  ambiguous?: boolean;
}

export function bidMessage(rig: Rig, amount: number, source: 'manual'): BidMsg;
export function bidMessage(rig: Rig, amount: number, source: 'voice', voice: VoiceFields): BidMsg;
export function bidMessage(
  rig: Rig,
  amount: number,
  source: 'manual' | 'voice',
  voice?: VoiceFields,
): BidMsg {
  const base = { v: 1 as const, t: 'bid' as const, mid: rig.ids.mint<'MsgId'>(), amount };
  if (source === 'manual' || voice === undefined) return { ...base, source: 'manual' };
  return {
    ...base,
    source: 'voice',
    confidence: voice.confidence,
    transcript: voice.transcript,
    ...(voice.ambiguous === undefined ? {} : { ambiguous: voice.ambiguous }),
  };
}

export function ledgerKey(auctionId: AuctionId): Ulid {
  return auctionId as unknown as Ulid;
}
