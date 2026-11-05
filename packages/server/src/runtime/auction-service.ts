import { randomUUID } from 'node:crypto';
import { AuctionRuntime, EngineError, type LedgerStore, type Ulid } from '@gavel/engine';
import {
  BridgeError,
  SettlementBridge,
  createEngineAdapter,
  createSettlement,
  createWebhookHandler,
  DEFAULT_HOLD_MAX_AGE_MS,
  guardGateway,
  reconcile,
  voidAllLiveHolds,
  revokeReasonFor,
  runCapturePhase,
  runVoidPhase,
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
  type ReconcileReport,
  type SettlementPlan,
  type VoidAllOutcome,
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
import { FencedStore } from '../room/fence';
import { Room, type RoomDeps } from '../room/room';
import type { HammerResult, SettlePort, SettlementReport } from '../room/settle-port';
import { dispatchAtHead } from './engine-dispatch';
import { LedgerEngine, commandIdFor, lotIdOf } from './ledger-engine';
import { reviewCodeOf } from './review-code';
import { isDefiniteRefusal, isReleased, voidOrphanHold, voidSpareHolds } from './void-phase';
import { WebhookIntake } from './webhook-intake';

/** Everything the service needs from the outside, as ports. */
export interface AuctionServiceDeps {
  /** Room event log and keyed state. */
  store: RoomStore;
  clock: Clock;
  ids: Ids;
  limiter?: RateLimiter;
  /** Counters fed from the room bid path (R-RT-122, R-RT-135). */
  roomMetrics?: RoomDeps['metrics'];
  /**
   * Engine ledger store. The engine runtime appends every accepted command here before the
   * room acknowledges it (see D-0014), and the hammer flushes whatever is still missing.
   */
  ledger: LedgerStore;
  journals: JournalStore;
  holds: HoldStore;
  webhookEvents: WebhookEventStore;
  audit: AuditSink;
  /** GAVEL_HOLD_MAX_AGE_MS: a hold older than this at settlement start is flagged stale. */
  holdMaxAgeMs?: number;
  gateway: PaymentsGateway;
  /** Checks PayPal's signature on a webhook delivery. */
  verifier: Pick<WebhookVerifier, 'verifyWebhook'>;
  /**
   * Required: leaving it out would let captures run while an operator believes they are
   * stopped. The service also wraps the gateway with it, so money-moving calls are refused
   * while it is engaged.
   */
  killSwitch: KillSwitch;
  metrics?: PaymentsMetrics;
  /**
   * Lease owner for the saga phases. Default: an id unique to this service instance
   * (process id plus random), so a restarted or second process cannot take over a lease
   * that a live run holds. Two instances must never share an owner.
   */
  leaseOwner?: string;
  /** Unknown capture outcome deadline, in ms (payments default when absent). */
  unknownDeadlineMs?: number;
  /** Voids sent at the same time (payments default 3 when absent). */
  voidConcurrency?: number;
  /**
   * Runs that may find a void still stuck before the settlement goes to review (payments
   * default 5 when absent).
   */
  maxVoidResumes?: number;
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
  /**
   * Receives the reconcile report of an auction once its settlement is SETTLED. Reconcile
   * only reads; a failed read is passed to `onError` and never blocks the settlement.
   */
  onReconcile?: (report: ReconcileReport) => Promise<void> | void;
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
  /** Loaded room count and open connections, for the metrics gauges. */
  stats(): { rooms: number; connections: number; mailboxDepth: number };
  registerBidder(input: RegisterBidderInput): Promise<void>;
  /**
   * Kill switch before the hammer: when the switch is engaged, ends every auction that has
   * not been hammered as an unsold lot (the engine records AbortLot), so settlement voids
   * every hold, and reports the result to the room. Returns the auctions it aborted. The
   * host calls it when it engages the switch; `resume()` calls it too, so a restart or the
   * periodic timer finishes an abort that was interrupted.
   */
  abortOpenLots(): Promise<string[]>;
  /**
   * True while holds may still be approved for the auction: it has not been hammered and no
   * settlement exists. A host passes it to the hold flow so an approval that lands after the
   * plan was cut is refused instead of leaving an authorization nobody voids.
   */
  acceptsHolds(auctionId: AuctionId): Promise<boolean>;
  /** Admin: voids every hold of the auction that is not captured (R-PAY-112). */
  voidAll(auctionId: AuctionId, actor: string): Promise<VoidAllOutcome>;
  /** Admin: compares the journal, the hold records and PayPal for one auction (R-PAY-100). */
  reconcile(auctionId: AuctionId): Promise<ReconcileReport>;
  /** The webhook route's body: raw request bytes and headers in, HTTP status out. */
  handleWebhook(
    rawBody: Buffer,
    headers: WebhookHeaders,
    source?: string,
  ): Promise<WebhookResponse>;
  /**
   * Loads every known room (which resumes hammered ones), continues unfinished
   * settlements and applies stored webhook events. Call it at start-up and on a timer.
   */
  resume(): Promise<void>;
  /** Resolves when no settlement run is in flight. */
  idle(): Promise<void>;
  /** Waits for in-flight settlement runs, then stops rooms. */
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

/** Holds a settlement in review keeps live: the winner's and the unresolved candidate's. */
function keptOnReview(journal: Journal): Set<string> {
  const keep = new Set<string>();
  if (journal.winner !== null) keep.add(journal.winner.holdId);
  const candidate = journal.plan.candidates[journal.cursor];
  const unresolved = candidate === undefined ? undefined : journal.holds[candidate.bidderId];
  if (unresolved !== undefined) keep.add(unresolved.holdId);
  return keep;
}

export function createAuctionService(deps: AuctionServiceDeps): AuctionService {
  return new Service(deps);
}

class Service implements AuctionService, SettlePort {
  private readonly rooms = new Map<string, Promise<Room>>();
  /** The same rooms once loaded, for synchronous gauges. */
  private readonly ready = new Map<string, Room>();
  /** Rooms this host lost to another host (R-RT-061); they are never served or resumed here. */
  private readonly fenced = new Set<string>();
  private readonly roomStore: RoomStore;
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
  private readonly owner: string;

  constructor(private readonly deps: AuctionServiceDeps) {
    this.payClock = { nowMs: () => deps.clock.now() };
    this.roomStore = new FencedStore(deps.store, { onFenced: (id) => this.onFenced(id) });
    this.gateway = guardGateway(withOrderLookup(deps.gateway, deps.holds), deps.killSwitch);
    this.owner = deps.leaseOwner ?? `service-${process.pid}-${randomUUID()}`;
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
      truth: (hold) =>
        this.gateway.getHoldTruth({
          holdId: hold.holdId,
          authId: hold.authId ?? '',
          orderId: hold.orderId,
        }),
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
    // The engine adapter runs a flat English lot with event holds, so refuse anything else
    // rather than show clients rules that never govern the lot (R-RT-011, R-RT-012).
    const c = parsed.data;
    if (c.mode !== 'english' || c.holdScope === 'lot' || c.incrementLadder !== undefined) {
      throw new GavelError('bad_message', 'unsupported mode, increment ladder or hold scope');
    }
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
    this.track(auctionId, created);
    try {
      return await created;
    } catch (e) {
      this.rooms.delete(auctionId);
      throw e;
    }
  }

  private track(auctionId: string, pending: Promise<Room>): void {
    pending.then(
      (room) => {
        if (this.rooms.get(auctionId) === pending) this.ready.set(auctionId, room);
      },
      () => undefined,
    );
  }

  /** Loaded room count and open connections, for the metrics gauges. */
  stats(): { rooms: number; connections: number; mailboxDepth: number } {
    let connections = 0;
    let mailboxDepth = 0;
    let rooms = 0;
    for (const [id, room] of this.ready) {
      if (!this.rooms.has(id)) continue;
      rooms += 1;
      connections += room.connectionCount;
      mailboxDepth = Math.max(mailboxDepth, room.mailboxDepth);
    }
    return { rooms, connections, mailboxDepth };
  }

  room(auctionId: AuctionId): Promise<Room> {
    if (this.fenced.has(auctionId)) {
      return Promise.reject(new GavelError('host_fenced', 'this host no longer owns the room'));
    }
    const known = this.rooms.get(auctionId);
    if (known !== undefined) return known;
    const loaded = Room.load(auctionId, this.roomDeps(auctionId));
    this.rooms.set(auctionId, loaded);
    this.track(auctionId, loaded);
    loaded.catch(() => {
      if (this.rooms.get(auctionId) === loaded) this.rooms.delete(auctionId);
    });
    return loaded;
  }

  /**
   * Another host appended to this room's log first. This host stops serving the room: timers
   * stop, commands are refused, and no settlement run or resume pass touches it again.
   */
  private onFenced(auctionId: string): void {
    this.fenced.add(auctionId);
    const timer = this.retryTimers.get(auctionId);
    if (timer !== undefined) clearTimeout(timer);
    this.retryTimers.delete(auctionId);
    this.retryCounts.delete(auctionId);
    const known = this.rooms.get(auctionId);
    this.rooms.delete(auctionId);
    this.ready.delete(auctionId);
    this.deps.onError?.(auctionId, new GavelError('host_fenced'));
    if (known !== undefined) void known.then((room) => room.stop()).catch(() => undefined);
  }

  private roomDeps(auctionId: AuctionId): RoomDeps {
    return {
      store: this.roomStore,
      clock: this.deps.clock,
      ids: this.deps.ids,
      engine: (config, createdAt) => new LedgerEngine(auctionId, config, createdAt),
      settle: this,
      durable: (id, engine) => this.flushLedger(id, engine, false),
      ...(this.deps.limiter !== undefined ? { limiter: this.deps.limiter } : {}),
      ...(this.deps.roomMetrics !== undefined ? { metrics: this.deps.roomMetrics } : {}),
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
    try {
      await room.registerBidder({
        bidderId: input.bidderId,
        name: input.name,
        ceiling: hold.ceilingCents as Cents,
        holdRef: hold.holdId,
      });
    } catch (e) {
      // A refused registration leaves a live authorization nobody uses. Once the plan is
      // cut it is not in the journal either, so it is released here (SERVICE-R3-09).
      if (isDefiniteRefusal(e)) await this.voidOrphan(input.auctionId, hold.holdId);
      if (e instanceof GavelError && e.code === 'conflict') {
        const journal = await this.deps.journals.load(lotIdOf(input.auctionId));
        if (journal !== null) await this.releaseSpares(journal);
      }
      throw e;
    }
  }

  /** Voids the hold of a refused registration; a failed void is reported, never masks the refusal. */
  private async voidOrphan(auctionId: AuctionId, holdId: string): Promise<void> {
    try {
      const status = await voidOrphanHold(
        {
          gateway: this.gateway,
          holds: this.deps.holds,
          audit: this.deps.audit,
          clock: this.payClock,
        },
        auctionId,
        holdId,
      );
      if (status === 'pending' || status === 'VOID_FAILED') {
        this.deps.onError?.(auctionId, new Error(`orphan hold ${holdId} void ${status}`));
      }
    } catch (e) {
      this.deps.onError?.(auctionId, e);
    }
  }

  async acceptsHolds(auctionId: AuctionId): Promise<boolean> {
    if (hammeredEngine(await this.room(auctionId)) !== undefined) return false;
    return (await this.deps.journals.load(lotIdOf(auctionId))) === null;
  }

  async voidAll(auctionId: AuctionId, actor: string): Promise<VoidAllOutcome> {
    return voidAllLiveHolds(
      {
        journals: this.deps.journals,
        gateway: this.gateway,
        audit: this.deps.audit,
        clock: this.payClock,
        owner: this.owner,
        boundary: (label) => this.boundary(label),
      },
      lotIdOf(auctionId),
      actor,
    );
  }

  reconcile(auctionId: AuctionId): Promise<ReconcileReport> {
    return reconcile(
      {
        gateway: this.gateway,
        journals: this.deps.journals,
        holds: this.deps.holds,
        clock: this.payClock,
        ...(this.deps.metrics !== undefined ? { metrics: this.deps.metrics } : {}),
      },
      lotIdOf(auctionId),
    );
  }

  // ---- webhooks

  handleWebhook(
    rawBody: Buffer,
    headers: WebhookHeaders,
    source?: string,
  ): Promise<WebhookResponse> {
    return this.webhook.handle(rawBody, headers, source);
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
      // Only the hold the room registered backs the bidder's ceiling. A spare hold that is
      // declined, expired or voided must not strike a bidder whose registered hold is good.
      if (room.holdRefs.get(hold.bidderId as BidderId) !== hold.holdId) {
        await this.rescheduleOpenJournal(hold.auctionId);
        return;
      }
      afterHammer =
        (await room.revokeBidder(hold.bidderId as BidderId, reason, hold.holdId)) === 'hammered';
    }
    if (afterHammer && this.synced.has(hold.auctionId)) await this.revokeInEngine(hold);
    await this.rescheduleOpenJournal(hold.auctionId);
  }

  private async rescheduleOpenJournal(auctionId: string): Promise<void> {
    const journal = await this.deps.journals.load(lotIdOf(auctionId as AuctionId));
    if (journal !== null && !TERMINAL.has(journal.state)) this.schedule(auctionId);
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
    if (this.runs.has(auctionId) || this.closed || this.fenced.has(auctionId)) return;
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
    if (this.closed || this.fenced.has(auctionId) || this.retryTimers.has(auctionId)) return;
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
    if (!(await killSwitch.isEngaged()).engaged) return [];
    const aborted: string[] = [];
    for (const id of await this.deps.store.listAuctions()) {
      if (this.fenced.has(id)) continue;
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
      if (this.fenced.has(id)) continue;
      // One unloadable auction must not stop the others from resuming.
      try {
        const room = await this.room(id);
        // A hammered room with no journal yet, or whose settle request was never stored, has
        // to be driven again; an earlier run may have died before the journal was created.
        await room.retrySettlement();
        const journal = await this.deps.journals.load(lotIdOf(id));
        if (await this.needsRun(id, room, journal)) this.schedule(id);
      } catch (e) {
        this.deps.onError?.(id, e);
      }
    }
    await this.intake.sweep();
  }

  /**
   * Whether a resume pass has to drive the settlement of this auction. A settlement that is
   * final and already reported to the room is left alone unless a live hold remains, so the
   * bridge and the PayPal reconcile do not repeat every minute for every finished auction.
   */
  private async needsRun(
    auctionId: AuctionId,
    room: Room,
    journal: Journal | null,
  ): Promise<boolean> {
    if (journal === null) return hammeredEngine(room) !== undefined && !room.isDone;
    if (!TERMINAL.has(journal.state) || !room.isDone) return true;
    const keep =
      journal.state === 'FAILED_NEEDS_REVIEW' ? keptOnReview(journal) : new Set<string>();
    // A review keeps the winner's and the unresolved candidate's hold on purpose (R8-S06).
    return (await this.deps.holds.listByAuction(auctionId)).some(
      (h) => h.status === 'HELD' && !keep.has(h.holdId),
    );
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.resumeTimer !== undefined) clearInterval(this.resumeTimer);
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
    // A settlement run in progress finishes before its room closes; no new run starts now.
    await this.idle();
    const results = await Promise.allSettled(
      [...this.rooms.values()].map(async (room) => (await room).close()),
    );
    const failed = results.find((r) => r.status === 'rejected');
    if (failed !== undefined) throw (failed as PromiseRejectedResult).reason;
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
        // No journal exists, so nothing else would ever release the bidders' money: void every
        // live hold now, keeping none, before the room goes final (R-PAY-037).
        let open = 0;
        try {
          open = await voidSpareHolds(
            { gateway: this.gateway, holds: this.deps.holds },
            { auctionId: lotId },
            new Set<string>(),
          );
        } catch (voidError) {
          this.deps.onError?.(auctionId, voidError);
          open = 1;
        }
        await room.reportSettlement({
          rev: 1,
          auctionState: 'FAILED_NEEDS_REVIEW',
          perBidder: {},
          note: REVIEW_NOTE,
        });
        return open > 0 ? 'again' : 'done';
      }
    }
    if (TERMINAL.has(journal.state)) {
      // A process that died after the journal ended but before the room heard the final
      // report: finish the engine side and send it. Repeated reports are dropped by rev.
      if (journal.state === 'FAILED_NEEDS_REVIEW') await this.releaseOnReview(journal);
      // A buyer who approved after the plan was cut has a live hold the journal does not know.
      await this.markReleasedHolds(journal);
      const open = await this.releaseSpares(journal);
      await this.finishBridge(room, auctionId, journal);
      return open > 0 ? 'again' : 'done';
    }
    await this.report(room, journal);
    if ((await this.releaseSpares(journal)) > 0) retry = true;

    const captured = await runCapturePhase(
      {
        journals: this.deps.journals,
        gateway: this.gateway,
        audit: this.deps.audit,
        clock: this.payClock,
        owner: this.owner,
        boundary: (label) => this.boundary(label),
        killSwitch: this.deps.killSwitch,
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
        audit: this.deps.audit,
        clock: this.payClock,
        owner: this.owner,
        boundary: (label) => this.boundary(label),
        ...(this.deps.metrics !== undefined ? { metrics: this.deps.metrics } : {}),
        ...(this.deps.voidConcurrency !== undefined
          ? { voidConcurrency: this.deps.voidConcurrency }
          : {}),
        ...(this.deps.maxVoidResumes !== undefined
          ? { maxVoidResumes: this.deps.maxVoidResumes }
          : {}),
      },
      lotId,
    );
    if (released.status === 'busy') return 'again';
    await this.markReleasedHolds(released.journal);
    if (released.status === 'failed') {
      await this.finishBridge(room, auctionId, released.journal);
      return 'done';
    }
    if (released.status === 'pending') {
      await this.report(room, released.journal);
      return released.reason === 'not_ready' ? 'done' : 'again';
    }
    if ((await this.releaseSpares(released.journal)) > 0) retry = true;
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
    const keep = keptOnReview(journal);
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
      // The plan is cut from the hammer-time facts: `lot.winnerId` and `lot.priceCents` move
      // when the engine already promoted past a skipped leader before a crash, but the
      // candidate list never does. prepare() then finds the promotion done and carries on.
      const hammer = lot.candidates[0];
      const outcome: PlanOutcome = {
        lotId,
        winnerId: hammer?.bidderId ?? lot.winnerId,
        priceCents: hammer?.priceCents ?? lot.priceCents,
        candidates: lot.candidates.map((c) => ({ bidderId: c.bidderId, priceCents: c.priceCents })),
      };
      plan = (await this.bridge.prepare(auctionId, outcome, holds, reserveCents)).plan;
    }
    await this.boundary('after:prepare');
    const created = await createSettlement(
      {
        journals: this.deps.journals,
        clock: this.payClock,
        holdMaxAgeMs: this.deps.holdMaxAgeMs ?? DEFAULT_HOLD_MAX_AGE_MS,
        audit: this.deps.audit,
      },
      plan,
    );
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

  /** Hold records follow the journal: a released authorization is VOIDED (also after a crash). */
  private async markReleasedHolds(journal: Journal): Promise<void> {
    for (const [bidderId, jh] of Object.entries(journal.holds)) {
      if (!isReleased(journal, bidderId, jh.holdId)) continue;
      const hold = await this.deps.holds.get(jh.holdId);
      if (hold === null || hold.status === 'VOIDED' || hold.status === 'CAPTURED') continue;
      await this.deps.holds.put({ ...hold, status: 'VOIDED' });
    }
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
    if (journal.state === 'SETTLED') await this.reconcileSettled(auctionId, journal);
  }

  /** One reconcile pass after SETTLED (R-PAY-063): captured plus released must equal the holds. */
  private async reconcileSettled(auctionId: AuctionId, journal: Journal): Promise<void> {
    try {
      const report = await reconcile(
        {
          gateway: this.gateway,
          journals: this.deps.journals,
          holds: this.deps.holds,
          clock: this.payClock,
          ...(this.deps.metrics !== undefined ? { metrics: this.deps.metrics } : {}),
        },
        journal.auctionId,
      );
      await this.deps.onReconcile?.(report);
    } catch (e) {
      this.deps.onError?.(auctionId, e);
    }
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
