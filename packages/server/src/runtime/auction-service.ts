import { randomUUID } from 'node:crypto';
import { AuctionRuntime, EngineError, type LedgerStore, type Ulid } from '@gavel/engine';
import {
  BridgeError,
  SettlementBridge,
  createEngineAdapter,
  createSettlement,
  createWebhookHandler,
  DEFAULT_HOLD_MAX_AGE_MS,
  HoldService,
  sweepStalePending,
  PendingReadBackoff,
  flagStaleHolds,
  lookupUnknownReauths,
  persistReauthorization,
  reauthorizeIfDue,
  recoverTrail,
  stateChangeRow,
  startReconcileTimer,
  guardGateway,
  reconcile,
  voidAllLiveHolds,
  revokeReasonFor,
  reviewKeepHolds,
  reviewKeepShrinksAt,
  runCapturePhase,
  runVoidPhase,
  step as stepSettlement,
  withLease,
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
  type ReauthPolicy,
  type ReauthUnknown,
  type Reauthorized,
  type ReconcileTimer,
  type ReconcileReport,
  type RemainderMode,
  type SettlementEvent,
  type SettlementPlan,
  type VoidAllOutcome,
  type VoidDeps,
  type WebhookEventStore,
  type WebhookHandler,
  type WebhookHeaders,
  type WebhookResponse,
  type WebhookVerifier,
} from '@gavel/payments';
import {
  GavelError,
  checkAuctionConfig,
  type AuctionConfig,
  type AuctionId,
  type BidderId,
  type Cents,
  type Clock,
  type EnginePort,
  type Ids,
  type RoomStore,
} from '@gavel/shared';
import { DEFAULT_CAPS, type CapLimits } from '../limits/caps';
import type { RateLimiter } from '../limits/rate-limiter';
import type { OpsRoomView, OpsSagaView } from '../http/ops';
import { FencedStore } from '../room/fence';
import { Room, type RoomDeps } from '../room/room';
import type { HammerResult, SettlePort, SettlementReport } from '../room/settle-port';
import { dispatchAtHead } from './engine-dispatch';
import { LedgerEngine, commandIdFor, lotIdOf } from './ledger-engine';
import { ownHoldsOf, settlementInvariants } from './own-holds';
import { reviewCodeOf } from './review-code';
import {
  isDefiniteRefusal,
  isReleased,
  voidOrphanHold,
  voidSpareHolds,
  type SpareVoidDeps,
} from './void-phase';
import { WebhookIntake, acceptsEventType } from './webhook-intake';

/** Everything the service needs from the outside, as ports. */
/** Pending holds younger than this are left to the normal approval flow. */
const DEFAULT_HOLD_SWEEP_MIN_AGE_MS = 10 * 60 * 1000;

export interface AuctionServiceDeps {
  /** Room event log and keyed state. */
  store: RoomStore;
  clock: Clock;
  ids: Ids;
  limiter?: RateLimiter;
  /** Connection, roster, room and bid caps from the config (R-RT-121); defaults when absent. */
  caps?: CapLimits;
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
  /** GAVEL_MAX_CEILING_CENTS: the ceiling cap the engine enforces. Defaults to the shared cap. */
  maxCeilingCents?: number;
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
  /** How long a capture PayPal reports PENDING is waited for, in ms (payments default three days). */
  pendingCaptureDeadlineMs?: number;
  /** G1 decision for the winner's remainder (payments default A, the recorded decision). */
  remainderMode?: RemainderMode;
  /** Voids sent at the same time (payments default 3 when absent). */
  voidConcurrency?: number;
  /**
   * Runs that may find a void still stuck before the settlement goes to review (payments
   * default 5 when absent).
   */
  maxVoidResumes?: number;
  /**
   * How long a settlement in review keeps the next candidates' holds live, in ms (R9-M04;
   * payments default 24 hours when absent). An operator can release them earlier with
   * `releaseReviewHolds`.
   */
  reviewHoldMaxAgeMs?: number;
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
  /** A pending hold older than this is swept for a crash-window authorization, in ms (default 10 min; negative turns it off). */
  holdSweepMinAgeMs?: number;
  /** How often `resume()` runs on its own, in ms; 0 turns the timer off. Default 60000. */
  resumeIntervalMs?: number;
  /**
   * Receives the reconcile report of an auction once its settlement is SETTLED. Reconcile
   * only reads; a failed read is passed to `onError` and never blocks the settlement.
   */
  onReconcile?: (report: ReconcileReport) => Promise<void> | void;
  /**
   * How often the periodic reconcile pass runs over settled auctions, in ms. Off (the
   * default) when absent or 0, so nothing changes unless an operator asks for it.
   */
  reconcileIntervalMs?: number;
  /** Let the periodic reconcile pass void holds that are still live after SETTLED. Default off. */
  reconcileRepair?: boolean;
  /**
   * Reauthorization policy (R-PAY-071): before the capture, a hold older than the honor
   * window is reauthorized once. Disabled when absent.
   */
  reauthPolicy?: ReauthPolicy;
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
  /**
   * The room, loaded from its log on first use. `settlement: true` marks a settlement, webhook,
   * recovery or kill-switch path: it may load beyond `MAX_ROOMS` when no finished room can be
   * evicted, because the cap is meant for new auctions, not for existing ones.
   */
  room(auctionId: AuctionId, opts?: { settlement?: boolean }): Promise<Room>;
  /** Loaded room count and open connections, for the metrics gauges. */
  stats(): { rooms: number; connections: number; mailboxDepth: number };
  /** The loaded rooms, for `GET /ops/rooms`. */
  opsRooms(): OpsRoomView[];
  /**
   * Settlement saga state per lot for the ops page and the saga metrics (R-QA-047): one row
   * for every auction with a journal, read from the journal store.
   */
  opsSagas(): Promise<OpsSagaView[]>;
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
  /**
   * Admin (R9-M04, R11-O01): a settlement in review keeps the next candidates' holds so the
   * lot can still fall back to them. This releases them now, before the review is
   * `reviewHoldMaxAgeMs` old. The hold of a capture in doubt and the winner's stay.
   */
  releaseReviewHolds(
    auctionId: AuctionId,
    actor: string,
  ): Promise<'released' | 'busy' | 'not_in_review'>;
  /**
   * Tells the service a hold was written HELD outside a settlement run, as the web approval
   * does (HRD-76). The resume pass stops treating its auction as final, and once the auction no
   * longer takes holds the settlement runs again, so a hold the plan does not know is voided.
   * Never throws: a failure goes to `onError` and the next resume pass looks at the auction.
   */
  holdApproved(holdId: string): Promise<void>;
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
 * Settlement states in which no capture has succeeded yet, so a reauthorization can still
 * matter. A settlement opened at the hammer stays HELD until the capture phase records the
 * hammer; CAPTURED and later states never reauthorize.
 */
const REAUTH_STATES: ReadonlySet<string> = new Set([
  'HELD',
  'BIDDING',
  'WINNER_SELECTED',
  'CAPTURING',
  'FALLBACK_RUNNER_UP',
]);

/** Passes in a row a hold's reauthorization may end unknown before the settlement goes to review. */
const MAX_REAUTH_UNKNOWN = 5;

/** History label of a review raised because a reauthorization stayed unknown. */
const REAUTH_REVIEW_LABEL = 'journaled:reauth_unknown';

/** True while a hold of the settlement has a reauthorization in doubt (RT4-saga-05). */
function reauthInDoubt(journal: Journal): boolean {
  return Object.values(journal.holds).some((h) => h.reauthInDoubt !== undefined);
}

/** How far back the periodic reconcile looks: lots settled within the last day. */
const RECONCILE_LOOKBACK_MS = 24 * 60 * 60 * 1000;

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

/** How long a room a client just asked for is kept from being unloaded. */
const CLIENT_TOUCH_GRACE_MS = 30_000;

export function createAuctionService(deps: AuctionServiceDeps): AuctionService {
  return new Service(deps);
}

class Service implements AuctionService, SettlePort {
  private readonly rooms = new Map<string, Promise<Room>>();
  /** The same rooms once loaded, for synchronous gauges. */
  private readonly ready = new Map<string, Room>();
  /** When each loaded room was last asked for, to evict the least recently used first. */
  private readonly lastUsed = new Map<string, number>();
  /** Last time a client path (not a settlement pass) asked for each room. */
  private readonly clientTouched = new Map<string, number>();
  /**
   * Auctions seen finished with a final settlement, each with the time from which the resume
   * pass looks at it again: never (Infinity) once nothing is left to release, or the moment a
   * review's keep-set lets a live hold go (HRD-76). Until then the pass does not reload them.
   */
  private readonly finalIds = new Map<string, number>();
  /** Spacing of the hold sweep's PayPal reads of abandoned checkouts (HRD-81). */
  private readonly pendingReads = new PendingReadBackoff();
  /** Auctions whose run in flight may have read the holds before one was written HELD. */
  private readonly rerun = new Set<string>();
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
  private readonly orphans = new Map<string, string>();
  /** Holds a registration is running for, so the raise sweep never voids one under way. */
  private readonly registering = new Set<string>();
  private readonly holdService: Pick<HoldService, 'completeApproval'>;
  private resumeTimer: ReturnType<typeof setInterval> | undefined;
  private reconcileTimer: ReconcileTimer | undefined;
  /** Reauthorizations PayPal made whose save found the settlement busy, per lot and hold. */
  private readonly reauthUnsaved = new Map<string, Reauthorized>();
  /** Passes in a row whose reauthorization of a hold ended unknown, per lot and hold. */
  private readonly reauthUnknown = new Map<string, number>();
  /** Lots settled before the reconcile look-back; their journals are not read again. */
  private readonly reconcileAged = new Set<string>();
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
    this.holdService = new HoldService({
      gateway: this.gateway,
      holds: deps.holds,
      audit: deps.audit,
      clock: this.payClock,
      // completeApproval, the only call made here, never reads the ceiling limit.
      maxCeilingCents: Number.MAX_SAFE_INTEGER,
    });
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
      // R11-O03: a capture event re-runs the settlement, which reads the truth again.
      onCaptureHint: (hold) => this.rescheduleOpenJournal(hold.auctionId),
      ...(deps.orphanWindowMs !== undefined ? { orphanWindowMs: deps.orphanWindowMs } : {}),
    });
    const every = deps.resumeIntervalMs ?? DEFAULT_RESUME_INTERVAL_MS;
    if (every > 0) {
      this.resumeTimer = setInterval(() => void this.tick(), every);
      this.resumeTimer.unref();
    }
    const reconcileEvery = deps.reconcileIntervalMs ?? 0;
    if (reconcileEvery > 0) {
      this.reconcileTimer = startReconcileTimer(
        {
          gateway: this.gateway,
          journals: deps.journals,
          holds: deps.holds,
          clock: this.payClock,
          audit: deps.audit,
          ...(deps.metrics !== undefined ? { metrics: deps.metrics } : {}),
          listAuctions: (sinceMs) => this.settledAuctions(sinceMs),
        },
        {
          intervalMs: reconcileEvery,
          // Only lots settled within the look-back are read at PayPal, so a pass does not
          // grow with every auction ever settled.
          sinceMs: () => this.payClock.nowMs() - RECONCILE_LOOKBACK_MS,
          ...(deps.reconcileRepair === true ? { repair: 'void_live_holds' as const } : {}),
          isActive: async () => !this.closed,
          onReport: ({ reports, errors }) => {
            for (const e of errors) this.deps.onError?.(e.auctionId, new Error(e.message));
            for (const r of reports)
              void Promise.resolve(this.deps.onReconcile?.(r)).catch(() => undefined);
          },
          setInterval: (fn, ms) => {
            const handle = setInterval(fn, ms);
            handle.unref();
            return handle;
          },
        },
      );
    }
    this.webhook = createWebhookHandler({
      verifier: deps.verifier,
      audit: deps.audit,
      clock: this.payClock,
      ...(deps.metrics !== undefined ? { metrics: deps.metrics } : {}),
      onVerified: (event) => this.intake.accept(event),
      acceptsEventType,
    });
  }

  // ---- rooms and bidders

  async createAuction(
    auctionId: AuctionId,
    config: AuctionConfig,
    auctioneerSub: string,
  ): Promise<Room> {
    const parsed = checkAuctionConfig(config, this.deps.clock.now());
    if (!parsed.ok) throw new GavelError('bad_message', 'invalid auction config');
    // The engine adapter runs a flat English lot with event holds, so refuse anything else
    // rather than show clients rules that never govern the lot (R-RT-011, R-RT-012).
    const c = parsed.config;
    if (c.mode !== 'english' || c.holdScope === 'lot' || c.incrementLadder !== undefined) {
      throw new GavelError('bad_message', 'unsupported mode, increment ladder or hold scope');
    }
    if (this.rooms.has(auctionId)) throw new GavelError('conflict', 'auction exists');
    await this.evictFinished();
    if (this.rooms.has(auctionId)) throw new GavelError('conflict', 'auction exists');
    if (this.rooms.size >= this.caps.rooms) throw new GavelError('room_cap', 'room cap reached');
    // Dry-run the engine build: a config or id it cannot run must never reach the log, or the
    // auction could not be loaded again and would block resume (R-RT-012, R-RT-059).
    // The engine lot is at most a day long and opens at creation time at the latest, so an end
    // time further away could not be settled early (bad_time at the ledger sync).
    if (parsed.config.endTs - this.deps.clock.now() > MAX_LOT_AHEAD_MS) {
      throw new GavelError('bad_message', 'end time is more than a day away');
    }
    try {
      new LedgerEngine(auctionId, parsed.config, this.deps.clock.now(), this.deps.maxCeilingCents);
    } catch {
      throw new GavelError('bad_message', 'auction config the engine cannot run');
    }
    const created = Room.create(auctionId, parsed.config, auctioneerSub, this.roomDeps(auctionId));
    this.rooms.set(auctionId, created);
    this.lastUsed.set(auctionId, this.deps.clock.now());
    this.track(auctionId, created);
    try {
      return await created;
    } catch (e) {
      this.rooms.delete(auctionId);
      throw e;
    }
  }

  /**
   * `MAX_ROOMS` bounds live rooms, not auctions per data directory (R12-S02): when the cap is
   * reached, rooms whose settlement is over and that no one is connected to are dropped, and
   * loaded again from their log if anything asks for them later.
   */
  private async evictFinished(): Promise<void> {
    if (this.rooms.size < this.caps.rooms) return;
    const candidates = [...this.ready]
      .filter(
        ([id, room]) =>
          this.rooms.has(id) &&
          room.isDone &&
          room.connectionCount === 0 &&
          !this.runs.has(id) &&
          !this.retryTimers.has(id),
      )
      .sort((a, b) => (this.lastUsed.get(a[0]) ?? 0) - (this.lastUsed.get(b[0]) ?? 0));
    for (const [id, room] of candidates) {
      // Never drop a room whose settlement is unfinished or that still has live holds: the
      // webhook, hold sweep and kill switch act on it through the loaded room.
      let busy = true;
      try {
        const auctionId = id as AuctionId;
        busy = await this.needsRun(
          auctionId,
          room,
          await this.deps.journals.load(lotIdOf(auctionId)),
        );
      } catch {
        busy = true;
      }
      // The room may have gained a connection or a run while the store was read.
      if (busy || room.connectionCount > 0 || this.runs.has(id) || !this.rooms.has(id)) continue;
      this.unload(id, room);
      if (this.rooms.size < this.caps.rooms) return;
    }
  }

  /**
   * A joining socket gets its room from `room()` and attaches a moment later, so a room asked
   * for by a client in the last few seconds is not dropped even when no connection shows yet.
   */
  private recentlyTouched(id: string): boolean {
    const at = this.clientTouched.get(id);
    return at !== undefined && this.deps.clock.now() - at < CLIENT_TOUCH_GRACE_MS;
  }

  /** Drops a finished room from memory; it loads again from its log if anything asks for it. */
  private unload(id: string, room: Room): void {
    this.dropRetry(id);
    this.rooms.delete(id);
    this.ready.delete(id);
    this.lastUsed.delete(id);
    this.clientTouched.delete(id);
    void room.close().catch(() => undefined);
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
  opsRooms(): OpsRoomView[] {
    const out: OpsRoomView[] = [];
    for (const [id, room] of this.ready) if (this.rooms.has(id)) out.push(room.opsView());
    return out;
  }

  async opsSagas(): Promise<OpsSagaView[]> {
    const out: OpsSagaView[] = [];
    for (const id of await this.deps.store.listAuctions()) {
      const lotId = lotIdOf(id);
      const journal = await this.deps.journals.load(lotId);
      if (journal === null) continue;
      const transitions: Record<string, number> = {};
      for (const h of journal.history) transitions[h.to] = (transitions[h.to] ?? 0) + 1;
      out.push({ auctionId: id, lotId, state: journal.state, transitions });
    }
    return out;
  }

  stats(): { rooms: number; connections: number; mailboxDepth: number } {
    let connections = 0;
    let mailboxDepth = 0;
    let rooms = 0;
    for (const [id, room] of this.ready) {
      if (!this.rooms.has(id)) continue;
      rooms += 1;
      connections += room.connectionCount;
      mailboxDepth += room.mailboxDepth;
    }
    return { rooms, connections, mailboxDepth };
  }

  async room(auctionId: AuctionId, opts: { settlement?: boolean } = {}): Promise<Room> {
    if (this.fenced.has(auctionId)) {
      throw new GavelError('host_fenced', 'this host no longer owns the room');
    }
    if (opts.settlement !== true) this.clientTouched.set(auctionId, this.deps.clock.now());
    const known = this.rooms.get(auctionId);
    if (known !== undefined) {
      this.lastUsed.set(auctionId, this.deps.clock.now());
      return known;
    }
    await this.evictFinished();
    // Another caller may have loaded it, or the host may have been fenced, meanwhile.
    const raced = this.rooms.get(auctionId);
    if (raced !== undefined) return raced;
    if (this.fenced.has(auctionId)) {
      throw new GavelError('host_fenced', 'this host no longer owns the room');
    }
    // Settlement-critical paths (settlement, webhooks, recovery, kill switch) act on an auction
    // that already exists, so the cap meant for new auctions must not refuse them: with no
    // finished room left to evict they load beyond the cap.
    if (opts.settlement !== true && this.rooms.size >= this.caps.rooms) {
      throw new GavelError('room_cap', 'room cap reached');
    }
    this.lastUsed.set(auctionId, this.deps.clock.now());
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
    this.dropRetry(auctionId);
    const known = this.rooms.get(auctionId);
    this.rooms.delete(auctionId);
    this.ready.delete(auctionId);
    this.lastUsed.delete(auctionId);
    this.deps.onError?.(auctionId, new GavelError('host_fenced'));
    if (known !== undefined) void known.then((room) => room.fence()).catch(() => undefined);
  }

  private get caps(): CapLimits {
    return this.deps.caps ?? DEFAULT_CAPS;
  }

  private roomDeps(auctionId: AuctionId): RoomDeps {
    return {
      store: this.roomStore,
      clock: this.deps.clock,
      ids: this.deps.ids,
      engine: (config, createdAt, cap) =>
        new LedgerEngine(auctionId, config, createdAt, cap ?? this.deps.maxCeilingCents),
      settle: this,
      durable: (id, engine) => this.flushLedger(id, engine, false),
      ...(this.deps.limiter !== undefined ? { limiter: this.deps.limiter } : {}),
      caps: this.caps,
      ...(this.deps.maxCeilingCents !== undefined
        ? { maxCeilingCents: this.deps.maxCeilingCents }
        : {}),
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
    // The hold the room used before this call; a raise replaces it (D-0025).
    const before = room.holdRefs.get(input.bidderId);
    this.registering.add(input.holdId);
    try {
      await room.registerBidder({
        bidderId: input.bidderId,
        name: input.name,
        ceiling: hold.ceilingCents as Cents,
        holdRef: hold.holdId,
      });
      // A raise switched the room to this hold: only now is the earlier hold voided, so the
      // bidder is never without one. A failed void is retried by the orphan sweep and, at the
      // latest, by the settlement's spare release.
      if (before !== undefined && before !== hold.holdId) {
        await this.voidOrphan(input.auctionId, before);
      }
    } catch (e) {
      // A refused registration leaves a live authorization nobody uses. Once the plan is
      // cut it is not in the journal either, so it is released here (SERVICE-R3-09).
      if (isDefiniteRefusal(e)) await this.voidOrphan(input.auctionId, hold.holdId);
      if (e instanceof GavelError && e.code === 'conflict') {
        const journal = await this.deps.journals.load(lotIdOf(input.auctionId));
        if (journal !== null) await this.releaseSpares(journal);
      }
      throw e;
    } finally {
      this.registering.delete(input.holdId);
    }
    // A webhook may have denied, voided or expired the hold while the registration waited in
    // the mailbox; onHoldStatus ignored it then because the room did not know the hold yet.
    // Read it again and revoke now, before any bid can lean on a dead hold (R-ENG-044).
    const after = await this.deps.holds.get(input.holdId);
    if (after !== null && after.status !== 'HELD') {
      const reason = revokeReasonFor(after.status);
      if (reason !== null) {
        await room.revokeBidder(input.bidderId, reason, after.holdId);
        await this.rescheduleOpenJournal(input.auctionId);
      }
    }
  }

  /** Voids the hold of a refused registration; a failed void is reported, never masks the refusal. */
  private async voidOrphan(auctionId: AuctionId, holdId: string): Promise<void> {
    const status = await this.voidOrphanOnce(auctionId, holdId);
    // A void that may not have gone through is retried by the next sweep, not at the hammer.
    if (status === 'pending' || status === 'VOID_FAILED') this.orphans.set(holdId, auctionId);
  }

  private async voidOrphanOnce(
    auctionId: AuctionId,
    holdId: string,
  ): Promise<Awaited<ReturnType<typeof voidOrphanHold>>> {
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
      return status;
    } catch (e) {
      this.deps.onError?.(auctionId, e);
      return 'VOID_FAILED';
    }
  }

  async acceptsHolds(auctionId: AuctionId): Promise<boolean> {
    if (hammeredEngine(await this.room(auctionId, { settlement: true })) !== undefined)
      return false;
    return (await this.deps.journals.load(lotIdOf(auctionId))) === null;
  }

  async voidAll(auctionId: AuctionId, actor: string): Promise<VoidAllOutcome> {
    // RT4-saga-05: a hold whose reauthorization is in doubt is moved to the authorization
    // PayPal made first, so the void reaches the funds.
    const before = await this.deps.journals.load(lotIdOf(auctionId));
    if (before !== null && reauthInDoubt(before)) await this.lookupReauths(lotIdOf(auctionId));
    const out = await voidAllLiveHolds(
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
    if (out.status === 'done') await this.markReleasedHolds(out.journal);
    return out;
  }

  async releaseReviewHolds(
    auctionId: AuctionId,
    actor: string,
  ): Promise<'released' | 'busy' | 'not_in_review'> {
    const lotId = lotIdOf(auctionId);
    const journal = await this.deps.journals.load(lotId);
    if (journal === null || journal.state !== 'FAILED_NEEDS_REVIEW') return 'not_in_review';
    await this.deps.audit.append({
      kind: 'void_all',
      auctionId: lotId,
      label: 'review_release',
      actor,
      tsMs: this.payClock.nowMs(),
    });
    if (reauthInDoubt(journal)) await this.lookupReauths(lotId);
    const released = await runVoidPhase(this.voidDeps({ releaseAllReviewHolds: true }), lotId);
    if (released.status === 'busy') return 'busy';
    await this.markReleasedHolds(released.journal);
    await this.finishBridge(
      await this.room(auctionId, { settlement: true }),
      auctionId,
      released.journal,
    );
    return 'released';
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
      const room = await this.room(hold.auctionId as AuctionId, { settlement: true });
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
        // The last run decides: a retry an earlier run armed has nothing left to wait for.
        else this.dropRetry(auctionId);
      })
      .catch((e: unknown) => this.deps.onError?.(auctionId, e))
      .finally(() => {
        if (this.runs.get(auctionId) === run) this.runs.delete(auctionId);
        if (this.rerun.delete(auctionId)) this.schedule(auctionId);
      });
    this.runs.set(auctionId, run);
  }

  async holdApproved(holdId: string): Promise<void> {
    let auctionId = 'hold-approval';
    try {
      const hold = await this.deps.holds.get(holdId);
      if (hold === null || hold.status !== 'HELD') return;
      auctionId = hold.auctionId;
      await this.afterHeld(hold.auctionId as AuctionId);
    } catch (e) {
      this.deps.onError?.(auctionId, e);
    }
  }

  /**
   * A hold of the auction was written HELD outside a settlement run (an approval, or the sweep
   * adopting a crash-window authorization). Whatever a resume pass concluded before, the
   * auction is not final now. Once the plan is cut the hold is not in it, so the settlement runs
   * again and its spare release voids it; a run in flight may have listed the holds before the
   * write, so it runs once more when it ends (HRD-76).
   */
  private async afterHeld(auctionId: AuctionId): Promise<void> {
    this.finalIds.delete(auctionId);
    if (this.fenced.has(auctionId) || (await this.acceptsHolds(auctionId))) return;
    if (this.runs.has(auctionId)) this.rerun.add(auctionId);
    else this.schedule(auctionId);
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

  private dropRetry(auctionId: string): void {
    const timer = this.retryTimers.get(auctionId);
    if (timer !== undefined) clearTimeout(timer);
    this.retryTimers.delete(auctionId);
    this.retryCounts.delete(auctionId);
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
      // Same rule as resume (#1749): a finished auction is not replayed to find out it cannot be
      // aborted; it is recognised from its last event and journal.
      const until = this.finalIds.get(id);
      if (until !== undefined && until <= this.deps.clock.now()) this.finalIds.delete(id);
      if (this.finalIds.has(id)) continue;
      if (!this.ready.has(id) && !this.runs.has(id) && !this.retryTimers.has(id)) {
        const quiet = await this.probeFinal(id);
        if (quiet !== null) {
          this.finalIds.set(id, quiet);
          continue;
        }
      }
      // One auction that cannot be aborted now must not keep the others open.
      try {
        const room = await this.room(id, { settlement: true });
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
      // HRD-76: a review that keeps a next candidate's live hold is final only until its
      // keep-set lets that hold go; from then on the auction is looked at again.
      const until = this.finalIds.get(id);
      if (until !== undefined && until <= this.deps.clock.now()) this.finalIds.delete(id);
      // A finished auction is recognised from its last event and journal, so a restart does not
      // replay the whole log of every old auction just to find out it is over (#1749).
      if (
        !this.finalIds.has(id) &&
        !this.ready.has(id) &&
        !this.runs.has(id) &&
        !this.retryTimers.has(id)
      ) {
        const quiet = await this.probeFinal(id);
        if (quiet !== null) this.finalIds.set(id, quiet);
      }
      if (this.finalIds.has(id)) {
        // Known final: never reloaded here, but a copy a client loaded since goes again once idle.
        const loaded = this.ready.get(id);
        if (loaded !== undefined && this.idleFinished(id, loaded)) this.unload(id, loaded);
        continue;
      }
      // One unloadable auction must not stop the others from resuming.
      try {
        const room = await this.room(id, { settlement: true });
        // A hammered room with no journal yet, or whose settle request was never stored, has
        // to be driven again; an earlier run may have died before the journal was created.
        await room.retrySettlement();
        const journal = await this.deps.journals.load(lotIdOf(id));
        const quiet = await this.quietUntil(id, room, journal);
        if (quiet === null) this.schedule(id);
        else if (this.idleFinished(id, room)) {
          // A finished auction with a final settlement takes no slot after boot (R12-S02) and
          // is not reloaded by later passes until `quiet`.
          this.finalIds.set(id, quiet);
          this.unload(id, room);
        }
      } catch (e) {
        this.deps.onError?.(id, e);
      }
    }
    await this.intake.sweep();
    await this.sweepHolds();
  }

  /**
   * Crash-window recovery (R8-P05) and retry of orphan voids that did not finish (HRD-16).
   * Each step reports through onError and never stops the others.
   */
  private async sweepHolds(): Promise<void> {
    for (const [holdId, auctionId] of [...this.orphans]) {
      const status = await this.voidOrphanOnce(auctionId as AuctionId, holdId);
      if (status !== 'pending' && status !== 'VOID_FAILED') this.orphans.delete(holdId);
    }
    const minAge = this.deps.holdSweepMinAgeMs ?? DEFAULT_HOLD_SWEEP_MIN_AGE_MS;
    if (minAge < 0) return;
    const recover = {
      gateway: this.gateway,
      holds: this.deps.holds,
      audit: this.deps.audit,
      clock: this.payClock,
      service: this.holdService,
      isAuctionOpen: (id: string) => this.acceptsHolds(id as AuctionId),
    };
    for (const id of await this.deps.store.listAuctions()) {
      if (this.fenced.has(id)) continue;
      try {
        const swept = await sweepStalePending(recover, id, minAge, undefined, {
          reads: this.pendingReads,
        });
        // An adopted authorization is a HELD write like an approval (HRD-76).
        if (swept.some((s) => s.result.status === 'authorized')) await this.afterHeld(id);
        await this.sweepUnregisteredRaises(id, minAge);
      } catch (e) {
        this.deps.onError?.(id, e);
      }
    }
  }

  /**
   * A raise hold that was approved but never registered with the room (the registration failed
   * after the approval, #2399) keeps a second authorization held next to the one the room uses.
   * Once it is older than `minAgeMs` it is voided, so the bidder is double held only for a
   * bounded time; a retry of the same amount then makes a fresh order. Open auctions only: a
   * closed one is settled, which voids spares itself.
   */
  private async sweepUnregisteredRaises(id: string, minAgeMs: number): Promise<void> {
    const auctionId = id as AuctionId;
    const now = this.payClock.nowMs();
    const stale = (await this.deps.holds.listByAuction(id)).filter(
      (h) =>
        h.status === 'HELD' &&
        h.supersedes !== undefined &&
        h.authId !== undefined &&
        now - h.createdAtMs > minAgeMs &&
        !this.registering.has(h.holdId),
    );
    // Only now look at the room: with no stale raise hold nothing is loaded (#1888).
    if (stale.length === 0 || !(await this.acceptsHolds(auctionId))) return;
    const room = await this.room(auctionId);
    for (const h of stale) {
      if (room.holdRefs.get(h.bidderId as BidderId) === h.holdId) continue;
      if (this.registering.has(h.holdId)) continue;
      await this.voidOrphan(auctionId, h.holdId);
    }
  }

  /**
   * A finished room nobody uses: no socket, no run in flight, no retry armed (unloading cancels
   * it, #1889) and no client asking for it now.
   */
  private idleFinished(id: string, room: Room): boolean {
    return (
      room.isDone &&
      room.connectionCount === 0 &&
      !this.runs.has(id) &&
      !this.retryTimers.has(id) &&
      !this.recentlyTouched(id)
    );
  }

  /**
   * When the log ends with a final settlement report and the journal is final: until when
   * nothing is left for resume to drive (see `finalUntil`). Reads one event, the journal and the
   * holds, never the whole log. Null on any doubt or read failure, and the room loads as before.
   */
  private async probeFinal(id: string): Promise<number | null> {
    try {
      const auctionId = id as AuctionId;
      const last = await this.deps.store.lastSeq(auctionId);
      if (last < 1) return null;
      const [event] = await this.deps.store.readEvents(auctionId, last, 1);
      if (event?.type !== 'settlement_update' || !TERMINAL.has(event.auctionState)) return null;
      const journal = await this.deps.journals.load(lotIdOf(auctionId));
      // #1889: the plan was never cut and the review voids every live hold, keeping none.
      if (journal === null) return (await this.heldLeft(auctionId)) ? null : Infinity;
      return await this.finalUntil(auctionId, journal);
    } catch {
      return null;
    }
  }

  /**
   * For a terminal settlement: null while a hold must be released now, otherwise until when
   * nothing is left to release, Infinity when never again. A review raised in the capture phase
   * keeps the next candidates' holds until it is `reviewHoldMaxAgeMs` old; while one of them is
   * still HELD the answer is that moment, when the release has to run although nobody is
   * connected (HRD-76). Only the holds are read; the keep-sets come from the journal.
   */
  private async finalUntil(auctionId: AuctionId, journal: Journal): Promise<number | null> {
    if (!TERMINAL.has(journal.state)) return null;
    // A reauthorization in doubt is looked up on the next run (RT4-saga-05).
    if (reauthInDoubt(journal)) return null;
    const held = (await this.deps.holds.listByAuction(auctionId)).filter(
      (h) => h.status === 'HELD',
    );
    if (journal.state !== 'FAILED_NEEDS_REVIEW') return held.length > 0 ? null : Infinity;
    const now = this.payClock.nowMs();
    const keep = this.reviewKeep(journal, now);
    if (held.some((h) => !keep.has(h.holdId))) return null;
    const shrinksAt = reviewKeepShrinksAt(journal, {
      nowMs: now,
      reviewHoldMaxAgeMs: this.deps.reviewHoldMaxAgeMs,
    });
    if (shrinksAt === null) return Infinity;
    const later = this.reviewKeep(journal, shrinksAt);
    return held.some((h) => !later.has(h.holdId)) ? shrinksAt : Infinity;
  }

  /** True while a hold record of the auction is still HELD. */
  private async heldLeft(auctionId: AuctionId): Promise<boolean> {
    return (await this.deps.holds.listByAuction(auctionId)).some((h) => h.status === 'HELD');
  }

  /**
   * Unfenced lots whose settlement became SETTLED at or after `sinceMs`: the ones the periodic
   * reconcile reads at PayPal. SETTLED is final, so a lot settled before the look-back is
   * remembered and its journal is not loaded again.
   */
  private async settledAuctions(sinceMs: number): Promise<string[]> {
    const out: string[] = [];
    for (const id of await this.deps.store.listAuctions()) {
      const lotId = lotIdOf(id as AuctionId);
      if (this.fenced.has(id) || this.reconcileAged.has(lotId)) continue;
      const journal = await this.deps.journals.load(lotId);
      if (journal?.state !== 'SETTLED') continue;
      const settledAtMs = [...journal.history].reverse().find((h) => h.to === 'SETTLED')?.tsMs;
      if (settledAtMs !== undefined && settledAtMs >= sinceMs) out.push(lotId);
      else this.reconcileAged.add(lotId);
    }
    return out;
  }

  /** Whether a resume pass has to drive the settlement of this auction now. */
  private async needsRun(
    auctionId: AuctionId,
    room: Room,
    journal: Journal | null,
  ): Promise<boolean> {
    return (await this.quietUntil(auctionId, room, journal)) === null;
  }

  /**
   * Null when a resume pass has to drive the settlement of this auction now, otherwise until
   * when it has nothing to drive. A settlement that is final and already reported to the room is
   * left alone unless a live hold remains, so the bridge and the PayPal reconcile do not repeat
   * every minute for every finished auction.
   */
  private async quietUntil(
    auctionId: AuctionId,
    room: Room,
    journal: Journal | null,
  ): Promise<number | null> {
    if (journal === null) {
      if (hammeredEngine(room) === undefined) return Infinity;
      if (!room.isDone) return null;
      // #1889: the plan could not be built and the review is reported. Every live hold is
      // voided, so one whose void did not confirm is still HELD and the run goes on.
      return (await this.heldLeft(auctionId)) ? null : Infinity;
    }
    if (!room.isDone) return null;
    // A review keeps some holds on purpose (R8-S06): the same set the release uses, so a
    // kept hold does not rerun the settlement and a hold the release must free does
    // (R11-O01, R11-O04). The next candidates leave the set once the review is old.
    return this.finalUntil(auctionId, journal);
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.resumeTimer !== undefined) clearInterval(this.resumeTimer);
    this.reconcileTimer?.stop();
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
    const room = await this.room(auctionId, { settlement: true });
    const engine = hammeredEngine(room);
    if (engine === undefined) throw new Error('auction is not hammered');
    const lotId = lotIdOf(auctionId);
    await this.syncLedger(auctionId, engine);
    let retry = false;

    let journal = await this.deps.journals.load(lotId);
    if (journal === null) {
      // #1889: the plan could not be built and the room already shows the review. A later run
      // only repeats the voids that did not confirm; no plan is cut after that report.
      if (room.isDone) return (await this.voidUnplanned(auctionId)) > 0 ? 'again' : 'done';
      try {
        journal = await this.openSettlement(auctionId, engine, room);
      } catch (e) {
        if (!(e instanceof BridgeError)) throw e;
        // Not retried silently: the room shows the review state and the host hears the code.
        this.deps.onError?.(auctionId, e);
        const open = await this.voidUnplanned(auctionId);
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
      if (journal.state === 'FAILED_NEEDS_REVIEW') journal = await this.releaseOnReview(journal);
      // A buyer who approved after the plan was cut has a live hold the journal does not know.
      await this.markReleasedHolds(journal);
      const open = await this.releaseSpares(journal);
      await this.finishBridge(room, auctionId, journal);
      return open > 0 || reauthInDoubt(journal) ? 'again' : 'done';
    }
    await this.report(room, journal);
    if ((await this.releaseSpares(journal)) > 0) retry = true;

    // PayPal closes the old authorization when it reauthorizes (A11): while a reauthorization
    // is unsettled no capture or void may run on the old id.
    const reauth = await this.reauthorizeDue(auctionId, journal);
    if (reauth.status === 'again') return 'again';
    if (reauth.status === 'review') {
      const reviewed = await this.releaseOnReview(reauth.journal);
      await this.finishBridge(room, auctionId, reviewed);
      // RT4-saga-05: the lot runs again until PayPal has answered the lookup.
      return reauthInDoubt(reviewed) ? 'again' : 'done';
    }
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
        ...(this.deps.pendingCaptureDeadlineMs !== undefined
          ? { pendingCaptureDeadlineMs: this.deps.pendingCaptureDeadlineMs }
          : {}),
      },
      lotId,
    );
    if (captured.status === 'busy') return 'again';
    if (captured.status === 'failed') {
      // Nobody can be charged until an operator decides; the holds the review does not keep
      // are freed now.
      const reviewed = await this.releaseOnReview(captured.journal);
      await this.finishBridge(room, auctionId, reviewed);
      return 'done';
    }
    if (captured.status === 'pending') {
      // RT4-saga-03: the capture phase waits (kill switch, a PENDING capture, PayPal reads or
      // OAuth failing). The holds nobody can be charged on any more are released now; the
      // winner's and the fallback candidates' holds stay.
      await this.report(room, await this.releaseOnReview(captured.journal));
      return 'again';
    }
    await this.report(room, captured.journal);
    if (captured.status === 'captured') await this.markCaptured(captured.journal);
    await this.boundary('after:capture-phase');

    const released = await runVoidPhase(this.voidDeps(), lotId);
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
   * Reauthorizes the holds still in play past the honor window, before the capture, when the
   * policy is on: the candidates from the cursor on that have not failed, while no capture
   * has succeeded yet (REAUTH_STATES). A hold that already has a prior authorization was
   * reauthorized once and is left alone, and so is a hold whose capture is in doubt.
   *
   * PayPal closes the old authorization when it reauthorizes (A11), so the capture waits
   * (`again`) while a reauthorization is unsettled: an unknown outcome, a save that found the
   * settlement busy, or an error. The next pass sends the same request id, so PayPal replays
   * a reauthorization it made; a result that could not be saved is kept and saved first.
   * When one hold's reauthorization ends unknown on MAX_REAUTH_UNKNOWN passes in a row, the
   * settlement goes to review (`review`) and `onError` is told. The count is kept in memory.
   */
  private async reauthorizeDue(
    auctionId: AuctionId,
    journal: Journal,
  ): Promise<{ status: 'ready' | 'again' } | { status: 'review'; journal: Journal }> {
    const policy = this.deps.reauthPolicy;
    if (policy === undefined || !policy.enabled) return { status: 'ready' };
    if (!REAUTH_STATES.has(journal.state)) return { status: 'ready' };
    const lotId = lotIdOf(auctionId);
    const failed = new Set(journal.failed.map((f) => f.bidderId));
    const inDoubt = journal.intent?.op === 'capture' ? journal.intent.holdId : undefined;
    let blocked = false;
    for (const cand of journal.plan.candidates.slice(journal.cursor)) {
      const hold = journal.holds[cand.bidderId];
      if (hold === undefined || failed.has(cand.bidderId) || hold.holdId === inDoubt) continue;
      const key = `${lotId}|${hold.holdId}`;
      try {
        let result = this.reauthUnsaved.get(key);
        if (result === undefined) {
          if ((hold.priorAuthIds?.length ?? 0) > 0) continue;
          const out = await reauthorizeIfDue(
            { gateway: this.gateway, audit: this.deps.audit, clock: this.payClock },
            lotId,
            {
              holdId: hold.holdId,
              authId: hold.authId,
              ceilingCents: hold.ceilingCents,
              startedAtMs: hold.createdAtMs ?? this.payClock.nowMs(),
              generation: hold.priorAuthIds?.length ?? 0,
            },
            policy,
          );
          if (out.status === 'unknown') {
            const unknown = (this.reauthUnknown.get(key) ?? 0) + 1;
            this.reauthUnknown.set(key, unknown);
            if (unknown >= MAX_REAUTH_UNKNOWN) {
              return await this.reviewReauth(auctionId, hold.holdId, out);
            }
            blocked = true;
            continue;
          }
          this.reauthUnknown.delete(key);
          if (out.status !== 'reauthorized') continue;
          result = out;
          this.reauthUnsaved.set(key, result);
        }
        const saved = await persistReauthorization(
          {
            journals: this.deps.journals,
            holds: this.deps.holds,
            clock: this.payClock,
            owner: this.owner,
          },
          lotId,
          hold.holdId,
          result,
        );
        if (saved === 'busy') blocked = true;
        else this.reauthUnsaved.delete(key);
      } catch (e) {
        this.deps.onError?.(auctionId, e);
        blocked = true;
      }
    }
    return { status: blocked ? 'again' : 'ready' };
  }

  /**
   * Sends a settlement to review because the reauthorization of `holdId` stayed unknown: the
   * funds may now be held under an authorization id this service never learned, so no
   * capture is tried on the old one. The lifecycle steps the capture phase would record come
   * first. The review is saved with the reauthorization's request id on the hold
   * (`reauthInDoubt`, RT4-saga-05), so the review release looks the authorization up instead
   * of releasing the old one, and the alert names the order and the request. Each step's
   * `state_change` row is written after its save and recovered from the history after a
   * crash (RT4-saga-04). `again` when the settlement is busy or has moved on.
   */
  private async reviewReauth(
    auctionId: AuctionId,
    holdId: string,
    out: ReauthUnknown,
  ): Promise<{ status: 'again' } | { status: 'review'; journal: Journal }> {
    const lotId = lotIdOf(auctionId);
    const leased = await withLease(
      { journals: this.deps.journals, clock: this.payClock },
      lotId,
      `${this.owner}-reauth-${randomUUID()}`,
      async (renew) => {
        const loaded = await this.deps.journals.load(lotId);
        if (loaded === null || !REAUTH_STATES.has(loaded.state)) return null;
        let audited = await recoverTrail(this.deps.audit, loaded);
        let j: Journal = loaded;
        const types: Array<'start_auction' | 'hammer' | 'invariant'> = [];
        if (j.state === 'HELD') types.push('start_auction');
        if (j.state === 'HELD' || j.state === 'BIDDING') types.push('hammer');
        types.push('invariant');
        const tsMs = this.payClock.nowMs();
        for (const type of types) {
          const label = type === 'invariant' ? REAUTH_REVIEW_LABEL : `journaled:${type}`;
          const event: SettlementEvent = { type, tsMs, label };
          const next = stepSettlement(j, event).journal;
          next.auditedSeq = audited;
          if (type === 'invariant') {
            for (const h of Object.values(next.holds)) {
              if (h.holdId === holdId) {
                h.reauthInDoubt = { requestId: out.requestId, amountCents: out.amountCents };
              }
            }
          }
          await renew();
          await this.deps.journals.save(next, j.version);
          j = next;
          const entry = next.history[next.history.length - 1];
          if (entry !== undefined) {
            await this.deps.audit.append(stateChangeRow(lotId, entry));
            audited = entry.seq;
          }
        }
        const done = structuredClone(j);
        done.auditedSeq = audited;
        done.version = j.version + 1;
        await renew();
        await this.deps.journals.save(done, j.version);
        return done;
      },
    );
    if (leased.status === 'busy' || leased.value === null) return { status: 'again' };
    for (const map of [this.reauthUnknown, this.reauthUnsaved]) {
      for (const key of [...map.keys()]) if (key.startsWith(`${lotId}|`)) map.delete(key);
    }
    const journalHold = Object.values(leased.value.holds).find((h) => h.holdId === holdId);
    const orderId = journalHold?.orderId ?? (await this.deps.holds.get(holdId))?.orderId;
    this.deps.onError?.(
      auctionId,
      new Error(
        `reauthorization of hold ${holdId} (order ${orderId ?? 'unknown'}, request ${out.requestId}) stayed unknown (${out.kind}) on ${MAX_REAUTH_UNKNOWN} passes; settlement sent to review`,
      ),
    );
    return { status: 'review', journal: leased.value };
  }

  /**
   * No journal exists, so nothing else would ever release the bidders' money: every live hold
   * is voided, keeping none, before and after the room goes final (R-PAY-037). Returns how many
   * voids are still unconfirmed; their records stay HELD, so resume runs again (#1889).
   */
  private async voidUnplanned(auctionId: AuctionId): Promise<number> {
    try {
      return await voidSpareHolds(
        this.spareDeps(),
        { auctionId: lotIdOf(auctionId) },
        new Set<string>(),
      );
    } catch (e) {
      this.deps.onError?.(auctionId, e);
      return 1;
    }
  }

  /**
   * Voids the live holds the settlement does not keep: a bidder's second hold, a hold of
   * someone who never registered. Returns how many voids are still unconfirmed.
   */
  private async releaseSpares(journal: Journal): Promise<number> {
    const keep = new Set(Object.values(journal.holds).map((h) => h.holdId));
    return voidSpareHolds(this.spareDeps(), journal, keep);
  }

  /** What `voidSpareHolds` needs: every void it sends is audited (R-PAY-132). */
  private spareDeps(): SpareVoidDeps {
    return {
      audit: this.deps.audit,
      clock: this.payClock,
      gateway: this.gateway,
      holds: this.deps.holds,
    };
  }

  /** The payments void phase as the service runs it: normal settlements and review releases. */
  private voidDeps(extra: Pick<VoidDeps, 'releaseAllReviewHolds'> = {}): VoidDeps {
    return {
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
      ...(this.deps.reviewHoldMaxAgeMs !== undefined
        ? { reviewHoldMaxAgeMs: this.deps.reviewHoldMaxAgeMs }
        : {}),
      ...(this.deps.remainderMode !== undefined ? { remainderMode: this.deps.remainderMode } : {}),
      ...extra,
    };
  }

  /** The holds a settlement in review keeps live at `nowMs` (payments `reviewKeepHolds`). */
  private reviewKeep(journal: Journal, nowMs: number): Set<string> {
    return reviewKeepHolds(journal, { nowMs, reviewHoldMaxAgeMs: this.deps.reviewHoldMaxAgeMs });
  }

  /**
   * A settlement in review releases the holds it does not keep through the payments void
   * phase, so this service and the payments package use one keep-set (`reviewKeepHolds`;
   * R9-M04, R11-O01, R11-O04): the winner's hold, the hold of a capture in doubt and, for a
   * review raised in the capture phase, the next candidates' holds until the review is
   * `reviewHoldMaxAgeMs` old. Every other hold of the journal is voided after a truth read,
   * so no bidder's money stays blocked until expiry. Holds outside the journal are left to
   * `releaseSpares`. Returns the journal as the release left it.
   *
   * The same call serves a capture phase that is waiting (RT4-saga-03): there the void phase
   * keeps the hold of an intent in flight and the holds of the candidate at the cursor and
   * after it, and releases the rest.
   */
  private async releaseOnReview(journal: Journal): Promise<Journal> {
    let latest = journal;
    if (reauthInDoubt(journal)) await this.lookupReauths(journal.auctionId);
    try {
      const released = await runVoidPhase(this.voidDeps(), journal.auctionId);
      if (released.status !== 'busy') latest = released.journal;
    } catch (e) {
      this.deps.onError?.(journal.auctionId, e);
    }
    await this.markReleasedHolds(latest);
    return latest;
  }

  /**
   * RT4-saga-05: looks up the authorization PayPal may have made for a reauthorization the
   * review saved as in doubt, and records it on the hold, so the review keeps and releases it
   * like the known holds. Until PayPal answers, the hold is not released and the lot is run
   * again.
   */
  private async lookupReauths(lotId: string): Promise<void> {
    try {
      await lookupUnknownReauths(
        {
          journals: this.deps.journals,
          holds: this.deps.holds,
          gateway: this.gateway,
          audit: this.deps.audit,
          clock: this.payClock,
          owner: this.owner,
        },
        lotId,
      );
    } catch (e) {
      this.deps.onError?.(lotId, e);
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
    // Mark live holds older than the maximum age on their records; they stay capturable.
    try {
      await flagStaleHolds(
        {
          holds: this.deps.holds,
          audit: this.deps.audit,
          clock: this.payClock,
          holdMaxAgeMs: this.deps.holdMaxAgeMs ?? DEFAULT_HOLD_MAX_AGE_MS,
        },
        lotId,
      );
    } catch (e) {
      this.deps.onError?.(auctionId, e);
    }
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
    // Per-hold detail from the same projection the settlement payload emitter publishes.
    const own = ownHoldsOf(journal, this.deps.clock.now());
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
      holds: own.holds,
      ...(own.winnerId !== undefined ? { winnerId: own.winnerId } : {}),
      invariants: settlementInvariants(own.holds),
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
