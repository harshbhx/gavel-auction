import { AuctionRuntime, EngineError, type LedgerStore, type Ulid } from '@gavel/engine';
import {
  BridgeError,
  SettlementBridge,
  createEngineAdapter,
  createSettlement,
  createWebhookHandler,
  revokeReasonFor,
  runCapturePhase,
  type AuditSink,
  type EngineEnvelope,
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
  type EnginePort,
  type Ids,
  type RoomStore,
} from '@gavel/shared';
import type { RateLimiter } from '../limits/rate-limiter';
import { Room, type RoomDeps } from '../room/room';
import type { HammerResult, SettlePort, SettlementReport } from '../room/settle-port';
import { dispatchAtHead } from './engine-dispatch';
import { LedgerEngine, commandIdFor, lotIdOf } from './ledger-engine';
import { reviewCodeOf } from './review-code';
import { isReleased, runVoidPhase, voidSpareHolds } from './void-phase';
import { WebhookIntake } from './webhook-intake';

/** Everything the service needs from the outside, as ports. */
export interface AuctionServiceDeps {
  /** Room event log and keyed state. */
  store: RoomStore;
  clock: Clock;
  ids: Ids;
  limiter?: RateLimiter;
  /**
   * Engine ledger store. The engine runtime appends every accepted command here before the
   * room acknowledges it (see D-0014), and the hammer flushes whatever is still missing.
   */
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
  /** First wait before an unfinished settlement run is tried again, in ms. Default 15000. */
  retryDelayMs?: number;
  /** Longest wait between two tries of one settlement; the wait doubles up to it. Default 300000. */
  retryMaxDelayMs?: number;
  /** How often `resume()` runs on its own, in ms; 0 turns the timer off. Default 60000. */
  resumeIntervalMs?: number;
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
  /**
   * Kill switch before the hammer: when the switch is engaged, ends every auction that has
   * not been hammered as an unsold lot (the engine records AbortLot), so settlement voids
   * every hold, and reports the result to the room. Returns the auctions it aborted. The
   * host calls it when it engages the switch; `resume()` calls it too, so a restart or the
   * periodic timer finishes an abort that was interrupted.
   */
  abortOpenLots(): Promise<string[]>;
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
  private readonly synced = new Set<string>();
  /** How many of a room engine's commands the ledger already holds, per engine instance. */
  private readonly cursors = new WeakMap<LedgerEngine, number>();
  private readonly ledgerLocks = new Map<string, Promise<void>>();
  private readonly runs = new Map<string, Promise<void>>();
  private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly retryCounts = new Map<string, number>();
  private resumeTimer: ReturnType<typeof setInterval> | undefined;
  private resuming = false;
  private closed = false;
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
          const result = await dispatchAtHead(this.runtime, cmd, contentCommandId(cmd));
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
    const every = deps.resumeIntervalMs ?? DEFAULT_RESUME_INTERVAL_MS;
    if (every > 0) {
      this.resumeTimer = setInterval(() => void this.tick(), every);
      this.resumeTimer.unref();
    }
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
    // Dry-run the engine build: a config or id it cannot run must never reach the log, or the
    // auction could not be loaded again and would block resume (R-RT-012, R-RT-059).
    // The engine lot is at most a day long and opens at creation time at the latest, so an end
    // time further away could not be settled early (bad_time at the ledger sync).
    if (parsed.data.endTs - this.deps.clock.now() > MAX_LOT_AHEAD_MS) {
      throw new GavelError('bad_message', 'end time is more than a day away');
    }
    try {
      new LedgerEngine(auctionId, parsed.data, this.deps.clock.now());
    } catch {
      throw new GavelError('bad_message', 'auction config the engine cannot run');
    }
    const created = Room.create(auctionId, parsed.data, auctioneerSub, this.roomDeps(auctionId));
    this.rooms.set(auctionId, created);
    try {
      return await created;
    } catch (e) {
      this.rooms.delete(auctionId);
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
      engine: (config, createdAt) => new LedgerEngine(auctionId, config, createdAt),
      settle: this,
      durable: (id, engine) => this.flushLedger(id, engine, false),
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

  /**
   * A hold changed because of a webhook. Before the hammer a hold that can no longer be
   * charged revokes the bidder's ceiling in the room (a logged room event, then the ledger),
   * so the leader is dropped at once; after the hammer the settlement bridge tells the engine.
   * Anything that fails goes back to the intake, which applies the event again.
   */
  private async onHoldStatus(hold: HoldRecord): Promise<void> {
    const reason = revokeReasonFor(hold.status);
    let afterHammer = true;
    if (reason !== null) {
      const room = await this.room(hold.auctionId as AuctionId);
      afterHammer = (await room.revokeBidder(hold.bidderId as BidderId, reason)) === 'hammered';
    }
    if (afterHammer && this.synced.has(hold.auctionId)) await this.revokeInEngine(hold);
    const journal = await this.deps.journals.load(lotIdOf(hold.auctionId as AuctionId));
    if (journal !== null && !TERMINAL.has(journal.state)) this.schedule(hold.auctionId);
  }

  private async revokeInEngine(hold: HoldRecord): Promise<void> {
    try {
      await this.bridge.onHoldStatus(hold.auctionId, hold);
    } catch (e) {
      // The engine may refuse a late revoke by rule; the settlement journal stays the source
      // of truth then. Anything else goes back to the intake, which applies the event again.
      if (!(e instanceof EngineError)) throw e;
      if (e.code === 'time_regression') throw e;
    }
  }

  private async tick(): Promise<void> {
    if (this.closed || this.resuming) return;
    this.resuming = true;
    try {
      await this.resume();
    } catch (e) {
      this.deps.onError?.('resume', e);
    } finally {
      this.resuming = false;
    }
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
    if (this.runs.has(auctionId) || this.closed) return;
    const run = this.settlementRun(auctionId as AuctionId)
      .then((outcome) => {
        if (outcome === 'again') this.armRetry(auctionId);
        else this.retryCounts.delete(auctionId);
      })
      .catch((e: unknown) => this.deps.onError?.(auctionId, e))
      .finally(() => {
        if (this.runs.get(auctionId) === run) this.runs.delete(auctionId);
      });
    this.runs.set(auctionId, run);
  }

  /**
   * A run that ended waiting (a capture whose outcome is unknown, a switch that is engaged, a
   * void PayPal has not confirmed) is tried again after a growing wait, so the settlement
   * does not depend on the host calling `resume()`.
   */
  private armRetry(auctionId: string): void {
    if (this.closed || this.retryTimers.has(auctionId)) return;
    const tries = this.retryCounts.get(auctionId) ?? 0;
    this.retryCounts.set(auctionId, tries + 1);
    const base = this.deps.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    const cap = this.deps.retryMaxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS;
    const timer = setTimeout(
      () => {
        this.retryTimers.delete(auctionId);
        this.schedule(auctionId);
      },
      Math.min(cap, base * 2 ** Math.min(tries, 20)),
    );
    timer.unref();
    this.retryTimers.set(auctionId, timer);
  }

  async idle(): Promise<void> {
    while (this.runs.size > 0) await Promise.all([...this.runs.values()]);
  }

  async abortOpenLots(): Promise<string[]> {
    const killSwitch = this.deps.killSwitch;
    if (killSwitch === undefined || !(await killSwitch.isEngaged()).engaged) return [];
    const aborted: string[] = [];
    for (const id of await this.deps.store.listAuctions()) {
      // One auction that cannot be aborted now must not keep the others open.
      try {
        const room = await this.room(id);
        await this.boundary('before:abort');
        if (await room.abort(ABORT_ACTOR)) aborted.push(id);
        await this.boundary('after:abort');
      } catch (e) {
        this.deps.onError?.(id, e);
      }
    }
    return aborted;
  }

  async resume(): Promise<void> {
    try {
      await this.abortOpenLots();
    } catch (e) {
      this.deps.onError?.('kill-switch', e);
    }
    for (const id of await this.deps.store.listAuctions()) {
      // One unloadable auction must not stop the others from resuming.
      try {
        const room = await this.room(id);
        // A hammered room with no journal yet, or whose settle request was never stored, has
        // to be driven again; an earlier run may have died before the journal was created.
        await room.retrySettlement();
        const journal = await this.deps.journals.load(lotIdOf(id));
        if (journal !== null || hammeredEngine(room) !== undefined) this.schedule(id);
      } catch (e) {
        this.deps.onError?.(id, e);
      }
    }
    await this.intake.sweep();
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.resumeTimer !== undefined) clearInterval(this.resumeTimer);
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
    for (const room of this.rooms.values()) await (await room).close();
  }

  private async boundary(label: string): Promise<void> {
    await this.deps.boundary?.(label);
  }

  private async settlementRun(auctionId: AuctionId): Promise<'done' | 'again'> {
    const room = await this.room(auctionId);
    const engine = hammeredEngine(room);
    if (engine === undefined) throw new Error('auction is not hammered');
    const lotId = lotIdOf(auctionId);
    await this.syncLedger(auctionId, engine);
    let retry = false;

    let journal = await this.deps.journals.load(lotId);
    if (journal === null) {
      try {
        journal = await this.openSettlement(auctionId, engine, room);
      } catch (e) {
        if (!(e instanceof BridgeError)) throw e;
        // Not retried silently: the room shows the review state and the host hears the code.
        this.deps.onError?.(auctionId, e);
        await room.reportSettlement({
          rev: 1,
          auctionState: 'FAILED_NEEDS_REVIEW',
          perBidder: {},
          note: REVIEW_NOTE,
        });
        return 'done';
      }
    }
    if (TERMINAL.has(journal.state)) {
      // A process that died after the journal ended but before the room heard the final
      // report: finish the engine side and send it. Repeated reports are dropped by rev.
      if (journal.state === 'FAILED_NEEDS_REVIEW') await this.releaseOnReview(journal);
      await this.finishBridge(room, auctionId, journal);
      return 'done';
    }
    await this.report(room, journal);
    if ((await this.releaseSpares(journal)) > 0) retry = true;

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
    if (captured.status === 'busy') return 'again';
    if (captured.status === 'failed') {
      // Nobody can be charged until an operator decides; the other bidders' money is freed now.
      await this.releaseOnReview(captured.journal);
      await this.finishBridge(room, auctionId, captured.journal);
      return 'done';
    }
    await this.report(room, captured.journal);
    if (captured.status === 'pending') return 'again';
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
    if (released.status === 'busy') return 'again';
    if (released.status === 'not_ready') return 'done';
    if (released.status === 'failed') {
      await this.finishBridge(room, auctionId, released.journal);
      return 'done';
    }
    if (released.status === 'pending') {
      await this.report(room, released.journal);
      return 'again';
    }
    await this.finishBridge(room, auctionId, released.journal);
    return retry ? 'again' : 'done';
  }

  /**
   * Voids the live holds the settlement does not keep: a bidder's second hold, a hold of
   * someone who never registered. Returns how many voids are still unconfirmed.
   */
  private async releaseSpares(journal: Journal): Promise<number> {
    const keep = new Set(Object.values(journal.holds).map((h) => h.holdId));
    return voidSpareHolds({ gateway: this.gateway, holds: this.deps.holds }, journal, keep);
  }

  /**
   * A settlement in review never reaches the void phase. Every hold except the one whose
   * capture is unresolved is released, so no bidder's money stays blocked until expiry.
   */
  private async releaseOnReview(journal: Journal): Promise<void> {
    const keep = new Set<string>();
    if (journal.winner !== null) keep.add(journal.winner.holdId);
    const candidate = journal.plan.candidates[journal.cursor];
    const unresolved = candidate === undefined ? undefined : journal.holds[candidate.bidderId];
    if (unresolved !== undefined) keep.add(unresolved.holdId);
    try {
      await voidSpareHolds({ gateway: this.gateway, holds: this.deps.holds }, journal, keep);
    } catch (e) {
      this.deps.onError?.(journal.auctionId, e);
    }
  }

  /** The ledger holds every command of the room engine, then `synced` is set for this process. */
  private async syncLedger(auctionId: AuctionId, engine: LedgerEngine): Promise<void> {
    if (this.synced.has(auctionId)) return;
    await this.flushLedger(auctionId, engine, true);
    this.synced.add(auctionId);
  }

  /**
   * Writes the room engine's commands the ledger does not have yet, in order, one writer per
   * auction. Command ids come from the command content, so a repeat after a crash (the cursor
   * is memory only) is a duplicate and writes nothing. With `hooks` the crash boundaries of
   * the hammer-time sync are visited; the per-bid flush has none.
   */
  private flushLedger(auctionId: string, engine: EnginePort, hooks: boolean): Promise<void> {
    if (!(engine instanceof LedgerEngine)) return Promise.resolve();
    const before = this.ledgerLocks.get(auctionId) ?? Promise.resolve();
    const run = before.catch(() => undefined).then(() => this.writeLedger(engine, hooks));
    this.ledgerLocks.set(auctionId, run);
    return run;
  }

  private async writeLedger(engine: LedgerEngine, hooks: boolean): Promise<void> {
    const commands = engine.commands;
    const from = this.cursors.get(engine) ?? 0;
    const total = commands.length;
    const middle = from + Math.floor((total - from) / 2);
    for (let i = from; i < total; i++) {
      const cmd = commands[i];
      if (cmd === undefined) break;
      await this.runtime.dispatch(cmd);
      this.cursors.set(engine, i + 1);
      if (hooks && i === middle) await this.boundary('mid:ledger-sync');
    }
    if (hooks) await this.boundary('after:ledger-sync');
  }

  /**
   * Plans the settlement from the engine's hammer outcome and the bidders' holds, tells
   * the engine about leaders that cannot be charged, then stores the journal.
   */
  private async openSettlement(
    auctionId: AuctionId,
    engine: LedgerEngine,
    room: Room,
  ): Promise<Journal> {
    const lotId = lotIdOf(auctionId);
    const state = await this.runtime.state(auctionId as unknown as Ulid);
    const lot = state.lots[lotId];
    if (lot === undefined) throw new Error('lot is missing from the engine ledger');
    const holds = await this.heldRefs(auctionId, room);
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

  /**
   * The hold each registered bidder joined with, as the saga's plan wants them. A second hold
   * the bidder approved later was never shown to the room, so it is not used; it is voided
   * as a spare instead.
   */
  private async heldRefs(auctionId: AuctionId, room: Room): Promise<Record<string, HoldRef>> {
    const out: Record<string, HoldRef> = {};
    const registered = room.holdRefs;
    for (const h of await this.deps.holds.listByAuction(auctionId)) {
      if (h.status !== 'HELD' || h.authId === undefined) continue;
      if (registered.get(h.bidderId as BidderId) !== h.holdId) continue;
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
      if (
        journal.state === 'SETTLED' &&
        !(await this.runtime.state(auctionId as unknown as Ulid)).closed
      ) {
        await this.bridge.closeIfDone(auctionId);
      }
    } catch (e) {
      // A rule failure after money moved (capture_mismatch, captured_over_ceiling, ...)
      // will not fix itself on a retry: hand it to an operator instead of rerunning the
      // same step on every resume (R-PAY-037).
      if (reviewCodeOf(e) === undefined) throw e;
      // The code stays with the host; viewers only learn that the result is under review.
      this.deps.onError?.(auctionId, e);
      await this.report(room, journal, { final: true, note: REVIEW_NOTE });
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
      // A review report sorts just below the report for the same journal version, so a
      // corrected report after the operator fixed the cause is never dropped as stale.
      rev: journal.version * 2 + (note === undefined ? 2 : 1),
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

const MAX_LOT_AHEAD_MS = 86_400_000;
const DEFAULT_RETRY_DELAY_MS = 15_000;
const DEFAULT_RETRY_MAX_DELAY_MS = 300_000;
const DEFAULT_RESUME_INTERVAL_MS = 60_000;
const ABORT_ACTOR = 'kill_switch';
const REVIEW_NOTE = 'needs_review';

/**
 * Id of a bridge command from what it says, not from a fresh random number: two drivers
 * (a webhook-triggered run and resume, or a run after a lease loss) that send the same step
 * produce the same id, and the engine answers the second as a duplicate instead of failing
 * with lot_done or state_continuity. The engine ignores the time when it compares a repeat.
 */
function contentCommandId(cmd: EngineEnvelope): string {
  switch (cmd.type) {
    case 'CompleteLot':
      return commandIdFor(cmd.auctionId, [cmd.type, cmd.lotId, cmd.bidderId, cmd.ref]);
    case 'RecordSettlement':
      return commandIdFor(cmd.auctionId, [cmd.type, cmd.lotId, cmd.ref]);
    case 'PromoteRunnerUp':
      return commandIdFor(cmd.auctionId, [cmd.type, cmd.lotId, cmd.disqualifiedBidderId]);
    case 'RevokeCeiling':
      return commandIdFor(cmd.auctionId, [cmd.type, cmd.bidderId, cmd.reason]);
    case 'CloseAuction':
      return commandIdFor(cmd.auctionId, [cmd.type]);
  }
}

/** The room's own engine once it has been hammered; never a partial rebuild's engine. */
function hammeredEngine(room: Room): LedgerEngine | undefined {
  const engine = room.activeEngine;
  return engine instanceof LedgerEngine && engine.hammered ? engine : undefined;
}

/** Per bidder state shown to viewers, from the journal alone. */
function perBidder(journal: Journal): Record<string, SettlementReport['auctionState']> {
  const out: Record<string, SettlementReport['auctionState']> = {};
  const settled = journal.state === 'SETTLED';
  for (const [bidderId, hold] of Object.entries(journal.holds)) {
    if (journal.winner?.bidderId === bidderId) out[bidderId] = settled ? 'SETTLED' : 'CAPTURED';
    else if (isReleased(journal, bidderId, hold.holdId)) out[bidderId] = 'SETTLED';
    else if (journal.state === 'VOIDING') out[bidderId] = 'VOIDING';
    else out[bidderId] = journal.state;
  }
  return out;
}
