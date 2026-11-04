import { AuctionRuntime, parseCommand, type LedgerStore, type Ulid } from '@gavel/engine';
import {
  SettlementBridge,
  BridgeError,
  createEngineAdapter,
  createSettlement,
  createWebhookHandler,
  runCapturePhase,
  type AuditSink,
  type HoldRecord,
  type HoldRef,
  type HoldStore,
  type Journal,
  type JournalStore,
  type KillSwitch,
  type PaymentsGateway,
  type PaymentsMetrics,
  type PlanOutcome,
  type SettlementPlan,
  type WebhookEventStore,
  type WebhookHandler,
  type WebhookHeaders,
  type WebhookResponse,
  type WebhookVerifier,
} from '@gavel/payments';
import {
  AuctionConfigSchema,
  GavelError,
  type AuctionConfig,
  type AuctionId,
  type BidderId,
  type Cents,
  type Clock,
  type Ids,
  type RoomStore,
} from '@gavel/shared';
import type { RateLimiter } from '../limits/rate-limiter';
import { Room, type RoomDeps } from '../room/room';
import type { HammerResult, SettlePort, SettlementReport } from '../room/settle-port';
import { LedgerEngine, lotIdOf } from './ledger-engine';
import { runVoidPhase } from './void-phase';
import { WebhookIntake } from './webhook-intake';

/** Everything the service needs from the outside, as ports. */
export interface AuctionServiceDeps {
  /** Room event log and keyed state. */
  store: RoomStore;
  clock: Clock;
  ids: Ids;
  limiter?: RateLimiter;
  /** Engine ledger store; the engine runtime appends here when an auction is hammered. */
  ledger: LedgerStore;
  journals: JournalStore;
  holds: HoldStore;
  webhookEvents: WebhookEventStore;
  audit: AuditSink;
  gateway: PaymentsGateway;
  /** Checks PayPal's signature on a webhook delivery. */
  verifier: Pick<WebhookVerifier, 'verifyWebhook'>;
  killSwitch?: KillSwitch;
  metrics?: PaymentsMetrics;
  /** Lease owner for the saga phases. Default "service". */
  leaseOwner?: string;
  /** Unknown capture outcome deadline, in ms (payments default when absent). */
  unknownDeadlineMs?: number;
  /** Void attempts per hold in one run (payments default 3 when absent). */
  maxVoidAttempts?: number;
  /** How long a webhook for an unknown hold is retried, in ms. */
  orphanWindowMs?: number;
  /**
   * Called at every crash boundary of the settlement run. A throw simulates a crash at
   * that point; the run stops and a later `resume()` continues. Labels are
   * `before:`/`after:` plus the step, and `journaled:` plus the saga event.
   */
  boundary?: (label: string) => Promise<void> | void;
  /** Told when a settlement run stops with an error. The run is not retried until `resume()`. */
  onError?: (auctionId: string, error: unknown) => void;
}

export interface RegisterBidderInput {
  auctionId: AuctionId;
  bidderId: BidderId;
  name: string;
  /** The bidder's hold; it must be HELD and belong to this bidder and auction. */
  holdId: string;
}

/**
 * The auction service the HTTP and WebSocket host mounts. It owns no transport:
 * the host passes connections to `room(id).attach(...)`, calls `registerBidder`
 * after a bidder's hold is approved, and hands PayPal's webhook bytes to
 * `handleWebhook`. Everything else (hammer, settlement, resume) happens inside.
 */
export interface AuctionService {
  /** Creates a room. `config` is validated against the shared schema. */
  createAuction(auctionId: AuctionId, config: AuctionConfig, auctioneerSub: string): Promise<Room>;
  /** The room, loaded from its log on first use. */
  room(auctionId: AuctionId): Promise<Room>;
  registerBidder(input: RegisterBidderInput): Promise<void>;
  /** The webhook route's body: raw request bytes and headers in, HTTP status out. */
  handleWebhook(rawBody: Buffer, headers: WebhookHeaders): Promise<WebhookResponse>;
  /**
   * Loads every known room (which resumes hammered ones), continues unfinished
   * settlements and applies stored webhook events. Call it at start-up and on a timer.
   */
  resume(): Promise<void>;
  /** Resolves when no settlement run is in flight. */
  idle(): Promise<void>;
  /** Stops rooms; in-flight settlement runs finish or stop on their own. */
  close(): Promise<void>;
}

const TERMINAL: ReadonlySet<string> = new Set(['SETTLED', 'FAILED_NEEDS_REVIEW']);

/**
 * The saga reads a hold's truth by authorization id alone, but only the order lists
 * the captures made on it. Adding the order id from the hold record lets a restart
 * after a capture recognise that capture instead of sending the winner to review.
 */
function withOrderLookup(gateway: PaymentsGateway, holds: HoldStore): PaymentsGateway {
  return {
    createOrder: (i) => gateway.createOrder(i),
    getOrder: (id) => gateway.getOrder(id),
    authorizeOrder: (id, requestId) => gateway.authorizeOrder(id, requestId),
    capture: (authId, i) => gateway.capture(authId, i),
    voidAuthorization: (authId, requestId) => gateway.voidAuthorization(authId, requestId),
    reauthorize: (authId, i) => gateway.reauthorize(authId, i),
    getHoldTruth: async (h) => {
      if (h.orderId !== undefined) return gateway.getHoldTruth(h);
      const hold = await holds.get(h.holdId);
      return gateway.getHoldTruth(hold === null ? h : { ...h, orderId: hold.orderId });
    },
  };
}

export function createAuctionService(deps: AuctionServiceDeps): AuctionService {
  return new Service(deps);
}

class Service implements AuctionService, SettlePort {
  private readonly rooms = new Map<string, Promise<Room>>();
  private readonly engines = new Map<string, LedgerEngine>();
  private readonly synced = new Set<string>();
  private readonly runs = new Map<string, Promise<void>>();
  private readonly runtime: AuctionRuntime;
  private readonly bridge: SettlementBridge;
  private readonly intake: WebhookIntake;
  private readonly webhook: WebhookHandler;
  private readonly payClock: { nowMs(): number };
  private readonly gateway: PaymentsGateway;

  constructor(private readonly deps: AuctionServiceDeps) {
    this.payClock = { nowMs: () => deps.clock.now() };
    this.gateway = withOrderLookup(deps.gateway, deps.holds);
    this.runtime = new AuctionRuntime({ store: deps.ledger });
    this.bridge = new SettlementBridge(
      createEngineAdapter({
        dispatch: async (cmd) => {
          await this.boundary(`before:engine:${cmd.type}`);
          const result = await this.runtime.dispatch(parseCommand(cmd));
          await this.boundary(`after:engine:${cmd.type}`);
          return result;
        },
        state: (id) => this.runtime.state(id as Ulid),
        read: (id, from) => deps.ledger.read(id as Ulid, from),
        newCommandId: () => deps.ids.mint(),
        nowMs: () => deps.clock.now(),
      }),
    );
    this.intake = new WebhookIntake({
      events: deps.webhookEvents,
      holds: deps.holds,
      clock: this.payClock,
      listAuctions: async () => [...(await deps.store.listAuctions())],
      onHoldStatus: (hold) => this.onHoldStatus(hold),
      ...(deps.orphanWindowMs !== undefined ? { orphanWindowMs: deps.orphanWindowMs } : {}),
    });
    this.webhook = createWebhookHandler({
      verifier: deps.verifier,
      audit: deps.audit,
      clock: this.payClock,
      ...(deps.metrics !== undefined ? { metrics: deps.metrics } : {}),
      onVerified: (event) => this.intake.accept(event),
    });
  }

  // ---- rooms and bidders

  async createAuction(
    auctionId: AuctionId,
    config: AuctionConfig,
    auctioneerSub: string,
  ): Promise<Room> {
    const parsed = AuctionConfigSchema.safeParse(config);
    if (!parsed.success) throw new GavelError('bad_message', 'invalid auction config');
    if (this.rooms.has(auctionId)) throw new GavelError('conflict', 'auction exists');
    const created = Room.create(auctionId, parsed.data, auctioneerSub, this.roomDeps(auctionId));
    this.rooms.set(auctionId, created);
    try {
      return await created;
    } catch (e) {
      this.rooms.delete(auctionId);
      this.engines.delete(auctionId);
      throw e;
    }
  }

  room(auctionId: AuctionId): Promise<Room> {
    const known = this.rooms.get(auctionId);
    if (known !== undefined) return known;
    const loaded = Room.load(auctionId, this.roomDeps(auctionId));
    this.rooms.set(auctionId, loaded);
    loaded.catch(() => {
      if (this.rooms.get(auctionId) === loaded) this.rooms.delete(auctionId);
    });
    return loaded;
  }

  private roomDeps(auctionId: AuctionId): RoomDeps {
    return {
      store: this.deps.store,
      clock: this.deps.clock,
      ids: this.deps.ids,
      engine: (config) => {
        const engine = new LedgerEngine(auctionId, config);
        this.engines.set(auctionId, engine);
        return engine;
      },
      settle: this,
      ...(this.deps.limiter !== undefined ? { limiter: this.deps.limiter } : {}),
    };
  }

  async registerBidder(input: RegisterBidderInput): Promise<void> {
    const hold = await this.deps.holds.get(input.holdId);
    if (
      hold === null ||
      hold.status !== 'HELD' ||
      hold.authId === undefined ||
      hold.auctionId !== input.auctionId ||
      hold.bidderId !== input.bidderId
    ) {
      throw new GavelError('forbidden', 'the bidder has no held hold in this auction');
    }
    const room = await this.room(input.auctionId);
    await room.registerBidder({
      bidderId: input.bidderId,
      name: input.name,
      ceiling: hold.ceilingCents as Cents,
      holdRef: hold.holdId,
    });
  }

  // ---- webhooks

  handleWebhook(rawBody: Buffer, headers: WebhookHeaders): Promise<WebhookResponse> {
    return this.webhook.handle(rawBody, headers);
  }

  /** A hold changed because of a webhook: tell the engine, and nudge a waiting settlement. */
  private async onHoldStatus(hold: HoldRecord): Promise<void> {
    if (this.synced.has(hold.auctionId)) {
      try {
        await this.bridge.onHoldStatus(hold.auctionId, hold);
      } catch {
        // The engine may refuse a late revoke; the settlement journal stays the source of truth.
      }
    }
    const journal = await this.deps.journals.load(lotIdOf(hold.auctionId as AuctionId));
    if (journal !== null && !TERMINAL.has(journal.state)) this.schedule(hold.auctionId);
  }

  // ---- settlement

  /**
   * The room's SettlePort. It only starts the run and returns: the run reports back
   * through `Room.reportSettlement`, which waits on the room's own mailbox, so
   * waiting for the run here would never finish.
   */
  async settle(auctionId: AuctionId, _outcome: HammerResult): Promise<void> {
    await this.boundary('before:settle');
    this.schedule(auctionId);
  }

  private schedule(auctionId: string): void {
    if (this.runs.has(auctionId)) return;
    const run = this.settlementRun(auctionId as AuctionId)
      .catch((e: unknown) => this.deps.onError?.(auctionId, e))
      .finally(() => {
        if (this.runs.get(auctionId) === run) this.runs.delete(auctionId);
      });
    this.runs.set(auctionId, run);
  }

  async idle(): Promise<void> {
    while (this.runs.size > 0) await Promise.all([...this.runs.values()]);
  }

  async resume(): Promise<void> {
    for (const id of await this.deps.store.listAuctions()) {
      await this.room(id);
      const journal = await this.deps.journals.load(lotIdOf(id));
      if (journal !== null) this.schedule(id);
    }
    await this.intake.sweep();
  }

  async close(): Promise<void> {
    for (const room of this.rooms.values()) await (await room).close();
  }

  private async boundary(label: string): Promise<void> {
    await this.deps.boundary?.(label);
  }

  private async settlementRun(auctionId: AuctionId): Promise<void> {
    const room = await this.room(auctionId);
    const engine = this.engines.get(auctionId);
    if (engine === undefined || !engine.hammered) throw new Error('auction is not hammered');
    const lotId = lotIdOf(auctionId);
    await this.syncLedger(auctionId, engine);

    let journal = await this.deps.journals.load(lotId);
    if (journal === null) journal = await this.openSettlement(auctionId, engine);
    if (TERMINAL.has(journal.state)) {
      // A process that died after the journal ended but before the room heard the final
      // report: finish the engine side and send it. Repeated reports are dropped by rev.
      await this.finishBridge(room, auctionId, journal);
      return;
    }
    await this.report(room, journal);

    const captured = await runCapturePhase(
      {
        journals: this.deps.journals,
        gateway: this.gateway,
        audit: this.deps.audit,
        clock: this.payClock,
        owner: this.deps.leaseOwner ?? 'service',
        boundary: (label) => this.boundary(label),
        ...(this.deps.killSwitch !== undefined ? { killSwitch: this.deps.killSwitch } : {}),
        ...(this.deps.metrics !== undefined ? { metrics: this.deps.metrics } : {}),
        ...(this.deps.unknownDeadlineMs !== undefined
          ? { unknownDeadlineMs: this.deps.unknownDeadlineMs }
          : {}),
      },
      lotId,
    );
    if (captured.status === 'busy') return;
    if (captured.status === 'failed') {
      await this.finishBridge(room, auctionId, captured.journal);
      return;
    }
    await this.report(room, captured.journal);
    if (captured.status === 'pending') return;
    if (captured.status === 'captured') await this.markCaptured(captured.journal);
    await this.boundary('after:capture-phase');

    const released = await runVoidPhase(
      {
        journals: this.deps.journals,
        gateway: this.gateway,
        holds: this.deps.holds,
        audit: this.deps.audit,
        clock: this.payClock,
        owner: this.deps.leaseOwner ?? 'service',
        boundary: (label) => this.boundary(label),
        ...(this.deps.maxVoidAttempts !== undefined
          ? { maxAttempts: this.deps.maxVoidAttempts }
          : {}),
      },
      lotId,
    );
    if (released.status === 'busy' || released.status === 'not_ready') return;
    if (released.status === 'pending') {
      await this.report(room, released.journal);
      return;
    }
    await this.finishBridge(room, auctionId, released.journal);
  }

  /** Replays the room engine's commands into the engine runtime, once per process. */
  private async syncLedger(auctionId: AuctionId, engine: LedgerEngine): Promise<void> {
    if (this.synced.has(auctionId)) return;
    const commands = engine.commands;
    const middle = Math.floor(commands.length / 2);
    for (const [i, cmd] of commands.entries()) {
      await this.runtime.dispatch(cmd);
      if (i === middle) await this.boundary('mid:ledger-sync');
    }
    await this.boundary('after:ledger-sync');
    this.synced.add(auctionId);
  }

  /**
   * Plans the settlement from the engine's hammer outcome and the bidders' holds, tells
   * the engine about leaders that cannot be charged, then stores the journal.
   */
  private async openSettlement(auctionId: AuctionId, engine: LedgerEngine): Promise<Journal> {
    const lotId = lotIdOf(auctionId);
    const state = await this.runtime.state(auctionId as unknown as Ulid);
    const lot = state.lots[lotId];
    if (lot === undefined) throw new Error('lot is missing from the engine ledger');
    const holds = await this.heldRefs(auctionId);
    const reserveCents = engine.config.reserve;

    let plan: SettlementPlan;
    if (lot.winnerId === null || lot.priceCents === null) {
      plan = { auctionId: lotId, reserveCents, candidates: [], holds };
    } else {
      const outcome: PlanOutcome = {
        lotId,
        winnerId: lot.winnerId,
        priceCents: lot.priceCents,
        candidates: lot.candidates.map((c) => ({ bidderId: c.bidderId, priceCents: c.priceCents })),
      };
      plan = (await this.bridge.prepare(auctionId, outcome, holds, reserveCents)).plan;
    }
    await this.boundary('after:prepare');
    const created = await createSettlement({ journals: this.deps.journals }, plan);
    await this.boundary('after:create-settlement');
    return created.journal;
  }

  /** The newest HELD hold of every bidder, as the saga's plan wants them. */
  private async heldRefs(auctionId: AuctionId): Promise<Record<string, HoldRef>> {
    const out: Record<string, HoldRef> = {};
    const all = await this.deps.holds.listByAuction(auctionId);
    for (const h of all.sort((a, b) => a.createdAtMs - b.createdAtMs)) {
      if (h.status !== 'HELD' || h.authId === undefined) continue;
      out[h.bidderId] = {
        holdId: h.holdId,
        authId: h.authId,
        ceilingCents: h.ceilingCents,
        createdAtMs: h.createdAtMs,
      };
    }
    return out;
  }

  private async markCaptured(journal: Journal): Promise<void> {
    const winnerHold = journal.winner?.holdId;
    if (winnerHold === undefined) return;
    const hold = await this.deps.holds.get(winnerHold);
    if (hold !== null && hold.status !== 'CAPTURED') {
      await this.deps.holds.put({ ...hold, status: 'CAPTURED' });
    }
  }

  /**
   * Engine side of the end of a settlement: record progress, complete the lot, close the
   * auction, and only then tell the room. A terminal report ends the room's resume, so
   * it must come after the engine has the result.
   */
  private async finishBridge(room: Room, auctionId: AuctionId, journal: Journal): Promise<void> {
    await this.boundary('before:bridge');
    try {
      await this.bridge.finish(auctionId, journal);
      // A restart after the close entry must not close twice (the engine rejects it).
      if (journal.state === 'SETTLED' && !(await this.runtime.state(auctionId as Ulid)).closed) {
        await this.bridge.closeIfDone(auctionId);
      }
    } catch (e) {
      if (!(e instanceof BridgeError)) throw e;
      await this.report(room, journal, { final: true, note: e.code });
      return;
    }
    await this.boundary('after:bridge');
    await this.report(room, journal, { final: true });
  }

  /** One progress report to the room. `rev` is the journal version, so reports stay ordered. */
  private async report(
    room: Room,
    journal: Journal,
    opts: { final?: boolean; note?: string } = {},
  ): Promise<void> {
    const terminal = TERMINAL.has(journal.state);
    if (terminal && opts.final !== true) return;
    const note = opts.note;
    const report: SettlementReport = {
      rev: journal.version + (note === undefined ? 0 : 1),
      auctionState: note === undefined ? journal.state : 'FAILED_NEEDS_REVIEW',
      perBidder: perBidder(journal),
      ...(journal.winner !== null && journal.state === 'SETTLED'
        ? { amountCaptured: journal.winner.amountCents as Cents }
        : {}),
      ...(note !== undefined ? { note } : {}),
    };
    await room.reportSettlement(report);
    await this.boundary('after:report');
  }
}

/** Per bidder state shown to viewers, from the journal alone. */
function perBidder(journal: Journal): Record<string, SettlementReport['auctionState']> {
  const out: Record<string, SettlementReport['auctionState']> = {};
  const settled = journal.state === 'SETTLED';
  for (const [bidderId, hold] of Object.entries(journal.holds)) {
    if (journal.winner?.bidderId === bidderId) out[bidderId] = settled ? 'SETTLED' : 'CAPTURED';
    else if (journal.voids[hold.holdId] !== undefined) out[bidderId] = 'SETTLED';
    else if (journal.state === 'VOIDING') out[bidderId] = 'VOIDING';
    else out[bidderId] = journal.state;
  }
  return out;
}
