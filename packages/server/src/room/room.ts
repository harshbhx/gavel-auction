import {
  ERROR_TABLE,
  GavelError,
  MAX_BIDDERS_PER_ROOM,
  MAX_HOLD_REF_CHARS,
  MAX_NAME_CHARS,
  encodeMsg,
  isCents,
  type AuctionConfig,
  type AuctionId,
  type AuditPayload,
  type BidMsg,
  type ConfirmResponseMsg,
  type BidderId,
  type BidId,
  type CancelTimer,
  type Clock,
  type Cents,
  type ConnId,
  type EngineBidResult,
  type EnginePort,
  type EngineView,
  type EpochMs,
  type ErrorCode,
  isErrorCode,
  type Ids,
  type RoomEvent,
  RoomEventSchema,
  type RoomSnapshot,
  type RoomStore,
  type ServerMsg,
  type Transport,
} from '@gavel/shared';
import { authorize, redactForViewer } from '../auth/authorize';
import {
  CONFIRM_TTL_MS,
  ConfirmBook,
  confirmAudit,
  isVoiceLike,
  needsConfirm,
  requestedEvent,
  type PendingConfirm,
} from './confirm';
import {
  CONFIRM_REASON,
  endsWithoutBid,
  resolvedEvent,
  type ConfirmOutcome,
} from './confirm-resolve';
import { DEFAULT_CAPS, type CapLimits } from '../limits/caps';
import type { RateLimiter } from '../limits/rate-limiter';
import {
  SUPERSEDED_CODE,
  SUPERSEDED_REASON,
  eventFrames,
  planResync,
  stripConfirmAudit,
} from './resync';
import {
  TERMINAL_SETTLEMENT,
  canHammer,
  type BidMeta,
  type ControlCommand,
  type HammerEnginePort,
  type HammerResult,
  type DurableHook,
  type RevokeReason,
  type SettlePort,
  type SettlementReport,
  canAbort,
  canPlaceWithMeta,
  canRevoke,
  canClock,
} from './settle-port';

/** One live connection as the room sees it. Identity comes from the verified token only. */
export interface Connection {
  id: ConnId;
  role: 'auctioneer' | 'bidder' | 'screen';
  /** Set for bidder tokens. */
  bidderId?: BidderId;
  /** Token subject, recorded in the audit trail for manual bids. */
  sub: string;
  transport: Transport;
  /**
   * A throwaway connection opened by an HTTP route. It skips the connection cap and never
   * supersedes a real socket that shares its role and subject.
   */
  internal?: boolean;
}

/** What a mid is bound to: the amount and the effective source (manual for the auctioneer). */
function bidDigest(amount: unknown, source: string): string {
  return `${isCents(amount) ? amount : ''}|${source}`;
}

/** The source and audit fields of a bid as the room records them, live and on replay. */
function bidMeta(conn: Connection, msg: BidMsg, confirmed = false): BidMeta {
  if (conn.role === 'auctioneer') {
    const meta: BidMeta = {
      source: 'manual',
      transcript: `manual by ${conn.sub}`.slice(0, 120),
    };
    return meta;
  }
  // A bidder frame may claim qr or voice only; manual is the auctioneer's entry (R-RT-039).
  const meta: BidMeta = { source: isVoiceLike(msg) ? 'voice' : 'qr' };
  if (msg.transcript !== undefined) meta.transcript = msg.transcript;
  if (meta.source === 'voice' && msg.confidence !== undefined) meta.confidence = msg.confidence;
  if (confirmed && meta.source === 'voice') meta.confirmed = true;
  return meta;
}

/** Accept only `ok: true`; a rejection must carry a known code; anything else is malformed. */
function bidOutcome(res: unknown): 'accepted' | 'malformed' | ErrorCode {
  if (typeof res !== 'object' || res === null) return 'malformed';
  const r = res as { ok?: unknown; code?: unknown };
  if (r.ok === true) return 'accepted';
  if (r.ok === false && isErrorCode(r.code)) return r.code;
  return 'malformed';
}

function placeBidOn(
  engine: EnginePort,
  bidder: BidderId,
  amount: Cents,
  ts: EpochMs,
  meta: BidMeta,
): EngineBidResult {
  return canPlaceWithMeta(engine)
    ? engine.placeBidWith(bidder, amount, ts, meta)
    : engine.placeBid(bidder, amount, ts);
}

export interface RoomDeps {
  store: RoomStore;
  clock: Clock;
  ids: Ids;
  /** Builds a fresh engine for a config; called again whenever the room is rebuilt from its log. */
  engine: (config: AuctionConfig, createdAt: EpochMs) => EnginePort;
  limiter?: RateLimiter;
  /** Connection, roster and bid-count caps parsed from the config (R-RT-121); defaults when absent. */
  caps?: CapLimits;
  /** Counters fed from the bid path (R-RT-122, R-RT-135). */
  metrics?: {
    bidAccepted(): void;
    bidRejected(): void;
    rateLimitHit(): void;
    bidLatencyMs?(ms: number): void;
    storeAppendMs?(ms: number): void;
  };
  /** Payments side of settlement; without it a hammered room stays in SETTLING. */
  settle?: SettlePort;
  /**
   * Runs after an event is in the room log and before it is acknowledged (R-ENG-076):
   * the host writes the engine ledger here. A throw withholds the acknowledgement; the
   * event stays committed and a retry of the same message is answered once this succeeds.
   */
  durable?: DurableHook;
}

/** What `revokeBidder` did. */
export type RevokeOutcome = 'applied' | 'noop' | 'hammered';

export interface RegisterBidder {
  bidderId: BidderId;
  name: string;
  ceiling: Cents;
  holdRef: string;
}

interface RosterEntry {
  paddle: number;
  name: string;
  ceiling: Cents;
  holdRef: string;
}

type Reply = Extract<ServerMsg, { t: 'bid_accepted' | 'bid_rejected' }>;

const READ_PAGE = 1000;
const RECENT_AUDIT = 50;
const AUTO_HAMMER_RETRY_MS = 2_000;

/** The control id of a kill-switch abort; one per auction, so a repeat is a no-op. */
function abortControlId(auctionId: string): string {
  return `abort:${auctionId}`;
}

/**
 * A single auction room. Every mutation goes through one FIFO mailbox that runs
 * one command at a time (R-RT-030); seq and server time are taken at dequeue
 * (R-RT-031); events are appended before anything is sent (R-RT-032) and a
 * failed append leaves state unchanged (R-RT-033).
 */
export class Room {
  private tail: Promise<void> = Promise.resolve();
  private inFlight = 0;
  private queued = 0;
  private closed = false;
  private maxInFlight = 0;
  private seq = 0;
  /** Accepted bids in the log; bounded by `caps.bidsPerAuction`. Rejected bids never count. */
  private bidCount = 0;
  private config: AuctionConfig | undefined;
  private engine: EnginePort | undefined;
  private lastState = 'OPEN';
  private roster = new Map<BidderId, RosterEntry>();
  private replies = new Map<string, { reply: Reply; digest: string }>();
  private audit: AuditPayload[] = [];
  private readonly conns = new Map<ConnId, Connection>();
  private cancelTimer: CancelTimer | undefined;
  private cancelHammer: CancelTimer | undefined;
  /** When the room entered CLOSING; the auto-hammer delay counts from here (R-RT-044). */
  private closingAt: number | undefined;
  private controlIds = new Set<string>();
  /** Confirmations the log shows as asked and not yet answered; filled by replay (R-RT-045). */
  private openConfirms = new Map<string, PendingConfirm>();
  /**
   * Accepted confirmations whose bid is not in the log yet, by `bidderId:mid`. A crash between
   * the resolution and the bid leaves one here after replay; revive asks the bidder again.
   */
  private acceptedWithoutBid = new Map<string, PendingConfirm>();
  private hammered: (HammerResult & { seq: number; ts: number }) | undefined;
  private settleRequested = false;
  private settleCalled = false;
  private abortPending = false;
  private revoked = new Set<BidderId>();
  private settlement: SettlementReport | undefined;
  private done = false;
  /** True when the engine may be ahead of the stored log and must be rebuilt first. */
  private dirty = false;
  /** Set when this host lost the room; the room serves nothing and arms no timer. */
  private stopped = false;
  private cancelTimerRetry: CancelTimer | undefined;
  /** Voice bids waiting for their bidder's answer; in memory only, the events are the record. */
  private readonly confirms = new ConfirmBook();
  /** Count of frames dropped because they failed to encode; surfaced for metrics and tests. */
  encodeFailures = 0;

  private constructor(
    readonly auctionId: AuctionId,
    private readonly deps: RoomDeps,
  ) {}

  private get caps(): CapLimits {
    return this.deps.caps ?? DEFAULT_CAPS;
  }

  /** Create a room: appends `auction_created` as seq 1. */
  static async create(
    auctionId: AuctionId,
    config: AuctionConfig,
    auctioneerSub: string,
    deps: RoomDeps,
  ): Promise<Room> {
    const room = new Room(auctionId, deps);
    await deps.store.appendEvents(auctionId, 0, [
      {
        type: 'auction_created',
        auctionId,
        seq: 1,
        ts: deps.clock.now(),
        config,
        auctioneerSub,
      },
    ]);
    await room.replay();
    room.armTimer();
    return room;
  }

  /** Rebuild a room by replaying its event log through a fresh engine (R-RT-059). */
  static async load(auctionId: AuctionId, deps: RoomDeps): Promise<Room> {
    const room = new Room(auctionId, deps);
    await room.replay();
    room.armTimer();
    await room.reviveConfirms();
    await room.resumeSettlement();
    return room;
  }

  /**
   * A restart loses the held bids. Put back those the log left open and re-arm their timers;
   * resolve the ones already past their deadline as expired, so every request ends (R-RT-046).
   */
  private async reviveConfirms(): Promise<void> {
    const now = this.deps.clock.now();
    const open = [...this.openConfirms.values()];
    this.openConfirms = new Map();
    const orphans = [...this.acceptedWithoutBid.values()];
    this.acceptedWithoutBid = new Map();
    for (const held of orphans) {
      // The accept was logged but the bid never was: the hold comes back with a fresh deadline.
      const again: PendingConfirm = { ...held, expiresAt: (now + CONFIRM_TTL_MS) as EpochMs };
      this.confirms.add(again);
      this.armConfirmTimer(again);
    }
    for (const held of open) {
      this.confirms.add(held);
      if (held.expiresAt > now) {
        this.armConfirmTimer(held);
      } else if (!(await this.enqueue(() => this.resolveConfirm(held, 'expired')))) {
        this.armConfirmTimer(held, now + AUTO_HAMMER_RETRY_MS);
      }
    }
  }

  /** Highest number of commands ever running at once; must stay at 1. */
  get maxConcurrent(): number {
    return this.maxInFlight;
  }

  /** The engine the room is running now; a half-built rebuild is never visible here. */
  get activeEngine(): EnginePort | undefined {
    return this.engine;
  }

  /** The hold each registered bidder joined with; the settlement charges against these. */
  get holdRefs(): ReadonlyMap<BidderId, string> {
    return new Map([...this.roster].map(([id, r]) => [id, r.holdRef]));
  }

  get lastSeq(): number {
    return this.seq;
  }

  /** Commands queued or running in the mailbox, for the depth gauge (R-RT-122). */
  get mailboxDepth(): number {
    return this.queued;
  }

  /** One line for the operator room list: sequence, state, connections and mailbox depth. */
  opsView(): {
    auctionId: string;
    seq: number;
    status: string;
    connections: number;
    mailboxDepth: number;
  } {
    let status = 'LOADING';
    try {
      status = this.done ? 'DONE' : this.requireEngine().view().state;
    } catch {
      // room not built yet
    }
    return {
      auctionId: this.auctionId,
      seq: this.seq,
      status,
      connections: this.conns.size,
      mailboxDepth: this.queued,
    };
  }

  get connectionCount(): number {
    return this.conns.size;
  }

  /**
   * Add a connection. With `lastSeq`, a client that missed at most 200 events gets those frames
   * replayed before the snapshot; otherwise it gets the snapshot only (R-RT-057). A token may
   * hold three connections; the oldest beyond that is closed as superseded (R-RT-058).
   */
  attach(conn: Connection, lastSeq?: number): Promise<void> {
    return this.enqueue(async () => {
      if (this.stopped) {
        this.sendError(conn, 'host_fenced');
        conn.transport.close(ERROR_TABLE.host_fenced.closeCode ?? 4010, 'host_fenced');
        return;
      }
      const mine = this.sameToken(conn);
      const supersedes = mine.length >= this.caps.connectionsPerBidder ? 1 : 0;
      const live = [...this.conns.values()].filter((c) => c.internal !== true).length;
      if (conn.internal !== true && live - supersedes + 1 > this.caps.connectionsPerRoom) {
        this.sendError(conn, 'room_full');
        conn.transport.close(ERROR_TABLE.room_full.closeCode ?? 4009, 'room_full');
        return;
      }
      this.supersedeOldest(conn);
      try {
        await this.ensureClean();
      } catch {
        // The engine may be ahead of the store: send nothing derived from it (R-RT-056).
        this.conns.set(conn.id, conn);
        this.sendError(conn, this.storeCode());
        return;
      }
      this.conns.set(conn.id, conn);
      const plan = planResync(lastSeq, this.seq);
      if (plan.kind === 'replay') {
        let events: RoomEvent[] = [];
        try {
          events = await this.deps.store.readEvents(
            this.auctionId,
            plan.from,
            plan.to - plan.from + 1,
          );
        } catch {
          events = [];
        }
        const complete = events.length === plan.to - plan.from + 1;
        if (complete) {
          for (const event of events) {
            const full = conn.role === 'auctioneer';
            for (const frame of eventFrames(event, full)) this.send(conn, frame);
          }
        }
      }
      this.sendState(conn);
    });
  }

  private sameToken(next: Connection): Connection[] {
    return [...this.conns.values()].filter(
      (c) =>
        c.internal !== true &&
        c.role === next.role &&
        c.sub === next.sub &&
        c.bidderId === next.bidderId,
    );
  }

  private supersedeOldest(next: Connection): void {
    if (next.internal === true) return;
    const mine = this.sameToken(next);
    while (mine.length >= this.caps.connectionsPerBidder) {
      const oldest = mine.shift();
      if (!oldest) break;
      this.conns.delete(oldest.id);
      oldest.transport.close(SUPERSEDED_CODE, SUPERSEDED_REASON);
    }
  }

  detach(connId: ConnId): void {
    this.conns.delete(connId);
  }

  /** Stop the room: later commands are refused and no timer is armed (R-RT-062). */
  async close(): Promise<void> {
    this.closed = true;
    this.cancelTimer?.();
    this.cancelTimer = undefined;
    this.cancelHammer?.();
    this.cancelHammer = undefined;
    this.cancelTimerRetry?.();
    this.cancelTimerRetry = undefined;
    this.confirms.clear();
    await this.tail;
  }

  /**
   * This host lost the room to another one (R-RT-061): cancel every timer and refuse further
   * commands with `host_fenced`. Nothing is rebuilt or re-armed afterwards.
   */
  stop(): void {
    this.stopped = true;
    this.confirms.clear();
    this.cancelTimer?.();
    this.cancelTimer = undefined;
    this.cancelHammer?.();
    this.cancelHammer = undefined;
    this.cancelTimerRetry?.();
    this.cancelTimerRetry = undefined;
  }

  /** True once the settlement's final report reached the room. */
  get isDone(): boolean {
    return this.done;
  }

  get isStopped(): boolean {
    return this.stopped;
  }

  /**
   * Every log append goes through here. A `conflict` means another host appended first, so this
   * host lost the room (R-RT-061): stop serving, tell every connection and close them with 4010.
   */
  private async appendFenced(
    auctionId: AuctionId,
    expectedSeq: number,
    events: RoomEvent[],
  ): Promise<void> {
    const started = this.deps.clock.now();
    try {
      await this.deps.store.appendEvents(auctionId, expectedSeq, events);
      this.deps.metrics?.storeAppendMs?.(this.deps.clock.now() - started);
    } catch (e) {
      if (e instanceof GavelError && e.code === 'conflict') {
        this.fence();
        throw new GavelError('host_fenced', 'this host no longer owns the room');
      }
      throw e;
    }
  }

  /** Stop the room, tell every connection `host_fenced` and close them with 4010. Idempotent. */
  fence(): void {
    if (this.stopped) return;
    this.stop();
    const closeCode = ERROR_TABLE.host_fenced.closeCode ?? 4010;
    for (const conn of [...this.conns.values()]) {
      this.sendError(conn, 'host_fenced');
      conn.transport.close(closeCode, 'host_fenced');
    }
    this.conns.clear();
  }

  private storeError(): GavelError {
    return new GavelError(this.stopped ? 'host_fenced' : 'store_unavailable');
  }

  private storeCode(): ErrorCode {
    return this.stopped ? 'host_fenced' : 'store_unavailable';
  }

  /** Report a payment hold: the bidder joins the roster with their private ceiling (R-RT-054). */
  registerBidder(reg: RegisterBidder): Promise<void> {
    return this.enqueue(async () => {
      try {
        await this.ensureClean();
      } catch {
        throw this.storeError();
      }
      if (this.roster.has(reg.bidderId)) {
        // A revoked bidder cannot be backed by a second hold; the caller releases it (D-0023).
        if (
          this.revoked.has(reg.bidderId) &&
          this.roster.get(reg.bidderId)?.holdRef !== reg.holdRef
        ) {
          throw new GavelError('conflict', 'ceiling was revoked');
        }
        // Another hold for a registered bidder is refused; the caller voids it (HRD-16).
        if (this.roster.get(reg.bidderId)?.holdRef !== reg.holdRef) {
          throw new GavelError('conflict', 'bidder is registered with another hold');
        }
        await this.makeDurable();
        return;
      }
      // The settlement plan is cut at the hammer; a later registration could never be voided (R-RT-054).
      if (this.hammered) throw new GavelError('conflict', 'auction is hammered');
      // Reject anything the wire or the event schema would refuse, before it reaches the log (R-RT-054).
      const name = reg.name.trim();
      if (
        name.length === 0 ||
        name.length > MAX_NAME_CHARS ||
        !isCents(reg.ceiling) ||
        reg.ceiling < (this.config?.reserve ?? 0) ||
        reg.holdRef.length === 0 ||
        reg.holdRef.length > MAX_HOLD_REF_CHARS
      ) {
        throw new GavelError('bad_message', 'invalid registration');
      }
      if (this.roster.size >= Math.min(this.caps.biddersPerRoom, MAX_BIDDERS_PER_ROOM))
        throw new GavelError('room_full');
      const seq = this.seq + 1;
      const ts = this.deps.clock.now();
      const paddle = this.roster.size + 1;
      const event: RoomEvent = {
        type: 'bidder_registered',
        auctionId: this.auctionId,
        seq,
        ts,
        bidderId: reg.bidderId,
        paddle,
        name,
        ceiling: reg.ceiling,
        holdRef: reg.holdRef,
      };
      try {
        await this.ensureClean();
      } catch {
        throw this.storeError();
      }
      // The engine decides first: a registration it refuses must never reach the log, or every
      // later replay would throw on it and the auction could not be loaded again (R-RT-059).
      try {
        this.applyRegistered(event);
      } catch {
        this.dirty = true;
        throw new GavelError('bad_message', 'registration refused by the engine');
      }
      try {
        await this.appendFenced(this.auctionId, this.seq, [event]);
      } catch (e) {
        // The engine already holds the bidder; rebuild it from the stored log (R-RT-033).
        await this.recover().catch(() => undefined);
        throw e;
      }
      this.seq = seq;
      // Tell everyone before the ledger write: the log append consumed the seq, and a ledger
      // failure that makes the host retry must not leave viewers with a gap (R-RT-036).
      for (const conn of this.conns.values()) {
        if (conn.role !== 'bidder' || conn.bidderId !== reg.bidderId) {
          // The seq is consumed by this event, so everyone else gets the new roster as a snapshot
          // instead of seeing a gap they would have to resync from (R-RT-036).
          this.sendState(conn);
          continue;
        }
        this.send(conn, {
          v: 1,
          t: 'registered',
          seq,
          ts,
          bidderId: reg.bidderId,
          paddle,
          ceiling: reg.ceiling,
          role: 'bidder',
        });
      }
      await this.makeDurable();
    });
  }

  /**
   * Submit a bid from a connection. Pipeline order (R-RT-035): rate limit, role
   * check, schema (already decoded), registered, engine validation.
   */
  submitBid(conn: Connection, msg: BidMsg): Promise<void> {
    const limited = this.deps.limiter?.checkBid(conn.bidderId ?? conn.id);
    if (limited && !limited.ok) {
      this.deps.metrics?.rateLimitHit();
      this.sendError(conn, 'rate_limited', limited.retryAfterMs);
      return Promise.resolve();
    }
    // Identity comes from the token; only auctioneer manual bids may name a bidder (R-RT-039).
    const manual = conn.role === 'auctioneer';
    const bidderId = manual ? msg.bidderId : conn.bidderId;
    const allowed = authorize(manual ? 'bid_manual_for_others' : 'bid_own', conn.role);
    if (!allowed.ok || bidderId === undefined) {
      this.sendError(conn, 'forbidden');
      return Promise.resolve();
    }
    return this.enqueue(async () => {
      const started = this.deps.clock.now();
      try {
        await this.handleBid(conn, msg, bidderId);
      } finally {
        this.deps.metrics?.bidLatencyMs?.(this.deps.clock.now() - started);
      }
    });
  }

  private async handleBid(
    conn: Connection,
    msg: BidMsg,
    bidderId: BidderId,
    confirmed = false,
  ): Promise<void> {
    const key = `${bidderId}:${msg.mid}`;
    const prior = this.replies.get(key);
    if (prior && prior.digest !== bidDigest(msg.amount, bidMeta(conn, msg).source)) {
      // The same mid with a different amount or submitter is not a replay (R-RT-034).
      this.sendError(conn, 'conflict');
      return;
    }
    if (prior) {
      // A replay returns the original reply and appends nothing (R-RT-034). The reply is
      // only repeated once the ledger holds the bid, so an acknowledgement is never ahead of it.
      try {
        await this.makeDurable();
      } catch {
        this.sendError(conn, this.storeCode());
        return;
      }
      this.send(conn, prior.reply);
      return;
    }
    try {
      await this.ensureClean();
    } catch {
      this.sendError(conn, this.storeCode());
      return;
    }
    if (this.bidCount >= this.caps.bidsPerAuction) {
      this.sendError(conn, 'auction_full');
      return;
    }
    const engine = this.requireEngine();
    if (
      !confirmed &&
      conn.role === 'bidder' &&
      this.config !== undefined &&
      isCents(msg.amount) &&
      this.roster.has(bidderId) &&
      !this.hammered &&
      engine.view().state === 'OPEN' &&
      needsConfirm(msg, this.config.confirmConfidenceThreshold)
    ) {
      await this.holdForConfirm(msg, bidderId);
      return;
    }
    const ts = this.deps.clock.now();
    const seq = this.seq + 1;

    let code: ErrorCode | undefined;
    if (!isCents(msg.amount)) code = 'bad_amount';
    else if (!this.roster.has(bidderId)) code = 'unregistered';
    else {
      try {
        const res: unknown = placeBidOn(
          engine,
          bidderId,
          msg.amount,
          ts,
          bidMeta(conn, msg, confirmed),
        );
        const outcome = bidOutcome(res);
        if (outcome === 'malformed') {
          // Not a result the room can trust: rebuild from the log and persist nothing (R-RT-035).
          this.dirty = true;
          this.sendError(conn, 'internal');
          return;
        }
        if (outcome !== 'accepted') code = outcome;
      } catch {
        // The engine may be half-mutated: rebuild from the log before the next command (R-RT-033).
        this.dirty = true;
        this.sendError(conn, 'internal');
        return;
      }
    }

    if (code === 'auction_paused') {
      // Transient and retryable: answer without logging, counting or caching, so the same mid
      // can be sent again once the lot resumes.
      this.send(conn, {
        v: 1,
        t: 'bid_rejected',
        seq: this.seq,
        ts,
        mid: msg.mid,
        reason: code,
        retryable: ERROR_TABLE[code].retryable,
      });
      return;
    }

    const bidId = this.deps.ids.mint<'BidId'>();
    const audit = this.buildAudit(bidId, bidderId, msg, conn, code, ts, seq, confirmed);
    const event: RoomEvent =
      code === undefined
        ? {
            type: 'bid_accepted',
            auctionId: this.auctionId,
            seq,
            ts,
            bidId,
            bidderId,
            mid: msg.mid,
            amount: msg.amount as Cents,
            source: audit.source,
            audit,
            endTsAfter: engine.view().endTs,
          }
        : {
            type: 'bid_rejected',
            auctionId: this.auctionId,
            seq,
            ts,
            bidderId,
            mid: msg.mid,
            ...(isCents(msg.amount) ? { amount: msg.amount } : {}),
            reason: code,
            audit,
          };

    try {
      await this.appendFenced(this.auctionId, this.seq, [event]);
    } catch {
      // State must not change: rebuild the engine from the log and tell the sender.
      await this.recover().catch(() => undefined);
      this.sendError(conn, this.storeCode());
      return;
    }
    this.seq = seq;
    if (event.type === 'bid_accepted') this.bidCount += 1;
    if (event.type === 'bid_accepted') this.deps.metrics?.bidAccepted();
    else this.deps.metrics?.bidRejected();
    this.pushAudit(audit);
    const reply = this.replyFor(event);
    if (reply) this.replies.set(key, { reply, digest: bidDigest(msg.amount, audit.source) });
    let durable = true;
    try {
      await this.makeDurable();
    } catch {
      durable = false;
    }
    if (reply && durable) this.send(conn, reply);
    else if (reply) this.sendError(conn, this.storeCode());
    if (event.type === 'bid_accepted') {
      this.armTimer();
      this.broadcastPrice(seq, ts);
    }
    this.broadcastAudit(audit, seq, ts);
  }

  /**
   * Answer to a confirm request (R-RT-046). Accept runs the normal pipeline at the server
   * time of the answer; reject, or an answer after the deadline, is audited and places no bid.
   */
  respondConfirm(conn: Connection, msg: ConfirmResponseMsg): Promise<void> {
    if (!authorize('confirm_response', conn.role).ok || conn.bidderId === undefined) {
      this.sendError(conn, 'forbidden');
      return Promise.resolve();
    }
    const bidderId = conn.bidderId;
    return this.enqueue(async () => {
      try {
        await this.ensureClean();
      } catch {
        this.sendError(conn, this.storeCode());
        return;
      }
      const held = this.confirms.get(msg.confirmId);
      if (!held || held.bidderId !== bidderId) {
        this.sendError(conn, 'not_found');
        return;
      }
      const late = this.deps.clock.now() >= held.expiresAt;
      const outcome: ConfirmOutcome = late ? 'expired' : msg.accept ? 'accepted' : 'rejected';
      if (outcome === 'accepted' && this.bidCount >= this.caps.bidsPerAuction) {
        // Refuse before the hold is consumed, so the resolution is never logged without a bid.
        this.sendError(conn, 'auction_full');
        return;
      }
      if (!(await this.resolveConfirm(held, outcome))) {
        this.sendError(conn, this.storeCode());
        return;
      }
      if (outcome !== 'accepted') return;
      const bid: BidMsg = {
        v: 1,
        t: 'bid',
        mid: held.mid,
        amount: held.amount,
        source: 'voice',
        ...(held.transcript !== undefined ? { transcript: held.transcript } : {}),
        ...(held.confidence !== undefined ? { confidence: held.confidence } : {}),
      };
      await this.handleBid(conn, bid, bidderId, true);
      if (!this.replies.has(`${bidderId}:${held.mid}`) && !this.stopped) {
        // The bid did not reach the log: put the hold back so the bidder can answer again.
        this.confirms.add(held);
        this.armConfirmTimer(held);
      }
    });
  }

  /** Hold a low-confidence or ambiguous voice bid and ask its bidder; the engine is not touched. */
  private async holdForConfirm(msg: BidMsg, bidderId: BidderId): Promise<void> {
    const ts = this.deps.clock.now();
    const prior = this.confirms.forBidder(bidderId);
    const held: PendingConfirm = {
      confirmId: this.deps.ids.mint<'ConfirmId'>(),
      bidderId,
      mid: msg.mid,
      amount: msg.amount as Cents,
      ...(msg.transcript !== undefined ? { transcript: msg.transcript } : {}),
      ...(msg.confidence !== undefined ? { confidence: msg.confidence } : {}),
      expiresAt: (ts + CONFIRM_TTL_MS) as EpochMs,
    };
    const events: RoomEvent[] = [];
    let seq = this.seq;
    if (prior) {
      seq += 1;
      const audit = confirmAudit(
        prior,
        this.deps.ids.mint<'BidId'>(),
        'superseded',
        CONFIRM_REASON.superseded,
        ts,
        seq,
      );
      events.push(
        resolvedEvent({ auctionId: this.auctionId, seq, ts }, prior.confirmId, 'superseded', audit),
      );
    }
    seq += 1;
    const askAudit = confirmAudit(
      held,
      this.deps.ids.mint<'BidId'>(),
      'rejected',
      'awaiting confirmation',
      ts,
      seq,
    );
    events.push(requestedEvent(this.auctionId, held, askAudit, seq, ts));
    try {
      await this.appendFenced(this.auctionId, this.seq, events);
    } catch {
      await this.recover().catch(() => undefined);
      const conn = [...this.conns.values()].find((c) => c.bidderId === bidderId);
      if (conn) this.sendError(conn, this.storeCode());
      return;
    }
    this.seq = seq;
    if (prior) this.confirms.drop(prior.confirmId);
    this.armConfirmTimer(held);
    this.confirms.add(held);
    for (const event of events) this.fanOutConfirm(event, held);
  }

  private armConfirmTimer(held: PendingConfirm, at: number = held.expiresAt): void {
    held.cancel = this.deps.clock.setTimer(at, () => {
      this.enqueue(async () => {
        if (this.stopped || this.confirms.get(held.confirmId) !== held) return;
        if (!(await this.resolveConfirm(held, 'expired'))) {
          // The log is unavailable: keep the held bid and try again shortly.
          this.armConfirmTimer(held, this.deps.clock.now() + AUTO_HAMMER_RETRY_MS);
        }
      }).catch(() => undefined);
    });
  }

  /** Write the end of a held bid to the log and tell the room. False when the log refused it. */
  private async resolveConfirm(held: PendingConfirm, outcome: ConfirmOutcome): Promise<boolean> {
    const ts = this.deps.clock.now();
    const seq = this.seq + 1;
    const audit = confirmAudit(
      held,
      this.deps.ids.mint<'BidId'>(),
      outcome,
      CONFIRM_REASON[outcome],
      ts,
      seq,
    );
    const event = resolvedEvent(
      { auctionId: this.auctionId, seq, ts },
      held.confirmId,
      outcome,
      audit,
    );
    try {
      await this.appendFenced(this.auctionId, this.seq, [event]);
    } catch {
      await this.recover().catch(() => undefined);
      return false;
    }
    this.seq = seq;
    this.confirms.drop(held.confirmId);
    this.fanOutConfirm(event, held);
    return true;
  }

  /**
   * Send one confirm event's seq to everyone: the request goes to its bidder only, an
   * unanswered end tells the bidder their bid was not placed, the auctioneer sees the audit row
   * of a resolution, and every other viewer gets a frame that keeps their seq whole (R-RT-036).
   */
  private fanOutConfirm(event: RoomEvent, held: PendingConfirm): void {
    for (const conn of this.conns.values()) {
      const own = conn.role === 'bidder' && conn.bidderId === held.bidderId;
      if (event.type === 'confirm_requested' && own) {
        this.send(conn, {
          v: 1,
          t: 'confirm_request',
          seq: event.seq,
          ts: event.ts,
          confirmId: event.confirmId,
          amount: event.amount,
          ...(held.transcript !== undefined ? { transcript: held.transcript } : {}),
          expiresAt: event.expiresAt,
        });
      } else if (event.type === 'confirm_resolved' && own && endsWithoutBid(event.outcome)) {
        this.send(conn, {
          v: 1,
          t: 'bid_rejected',
          seq: event.seq,
          ts: event.ts,
          mid: held.mid,
          reason: 'unconfirmed',
          retryable: ERROR_TABLE.unconfirmed.retryable,
        });
      } else if (
        event.type === 'confirm_resolved' &&
        event.outcome !== 'accepted' &&
        conn.role === 'auctioneer'
      ) {
        this.send(conn, {
          v: 1,
          t: 'audit_event',
          seq: event.seq,
          ts: event.ts,
          audit: stripConfirmAudit(event.audit),
        });
      } else {
        this.sendSeqFiller(conn, event.seq, event.ts);
      }
    }
  }

  private buildAudit(
    bidId: BidId,
    bidderId: BidderId,
    msg: BidMsg,
    conn: Connection,
    code: ErrorCode | undefined,
    ts: ReturnType<Clock['now']>,
    seq: number,
    confirmed = false,
  ): AuditPayload {
    const audit: AuditPayload = {
      bidId,
      bidderId,
      source: bidMeta(conn, msg).source,
      outcome: code === undefined ? 'accepted' : 'rejected',
      serverTs: ts,
      seq,
    };
    if (isCents(msg.amount)) audit.parsedAmount = msg.amount;
    const meta = bidMeta(conn, msg, confirmed);
    if (meta.confirmed) audit.confirmed = true;
    if (meta.transcript !== undefined) audit.transcript = meta.transcript;
    if (meta.confidence !== undefined) audit.confidence = meta.confidence;
    if (code !== undefined) audit.reason = code;
    return audit;
  }

  /** The reply frame for a persisted bid event; identical live and after a restart. */
  private replyFor(event: RoomEvent): Reply | undefined {
    if (event.type === 'bid_accepted') {
      return {
        v: 1,
        t: 'bid_accepted',
        seq: event.seq,
        ts: event.ts,
        mid: event.mid,
        bidId: event.bidId,
        amount: event.amount,
      };
    }
    if (event.type === 'bid_rejected') {
      return {
        v: 1,
        t: 'bid_rejected',
        seq: event.seq,
        ts: event.ts,
        mid: event.mid,
        reason: event.reason,
        retryable: ERROR_TABLE[event.reason].retryable,
      };
    }
    return undefined;
  }

  /**
   * Auctioneer control command (R-RT-048). Idempotent by `controlId`. `hammer` closes the lot;
   * `open`, `pause`, `resume` and `extend` act on the engine clock (R-RT-049) and are audited
   * as control records in the log, so a rebuilt room replays them.
   */
  control(conn: Connection, cmd: ControlCommand): Promise<void> {
    if (!authorize('control', conn.role).ok) {
      this.sendError(conn, 'forbidden');
      return Promise.resolve();
    }
    if (cmd.controlId.length === 0) {
      this.sendError(conn, 'bad_message');
      return Promise.resolve();
    }
    if (cmd.action !== 'hammer') return this.enqueue(() => this.clockControl(conn, cmd));
    return this.enqueue(async () => {
      try {
        await this.ensureClean();
      } catch {
        this.sendError(conn, this.storeCode());
        return;
      }
      if (this.hammered) {
        // A repeat returns the same result and appends nothing (R-RT-050).
        this.sendHammer(conn, this.hammered);
        return;
      }
      if (this.controlIds.has(cmd.controlId)) return;
      const engine = this.requireEngine();
      if (canClock(engine) && engine.paused) {
        this.sendError(conn, 'conflict');
        return;
      }
      const open = engine.view().state === 'OPEN';
      if (open && cmd.args?.closeNow !== 1) {
        this.sendError(conn, 'conflict');
        return;
      }
      await this.doHammer({ conn, cmd });
    });
  }

  private async clockControl(conn: Connection, cmd: ControlCommand): Promise<void> {
    try {
      await this.ensureClean();
    } catch {
      this.sendError(conn, this.storeCode());
      return;
    }
    // A repeat returns the first result and appends nothing (R-RT-050).
    if (this.controlIds.has(cmd.controlId)) return;
    const engine = this.requireEngine();
    if (!canClock(engine)) {
      this.sendError(conn, 'bad_message');
      return;
    }
    // `open` has no engine command: the lot is already open or cannot be opened, so nothing
    // may be audited as accepted (R-RT-048).
    if (cmd.action === 'open' || this.hammered || engine.view().state !== 'OPEN') {
      this.sendError(conn, 'conflict');
      return;
    }
    const extraMs = cmd.args?.extraMs;
    if (
      cmd.action === 'extend' &&
      (extraMs === undefined || !Number.isInteger(extraMs) || extraMs < 1 || extraMs > 600_000)
    ) {
      this.sendError(conn, 'bad_message');
      return;
    }
    const seq = this.seq + 1;
    const ts = this.deps.clock.now();
    try {
      this.applyClock(engine, cmd.action, ts, extraMs);
    } catch (e) {
      if (e instanceof GavelError && e.code === 'conflict') {
        this.sendError(conn, 'conflict');
        return;
      }
      this.dirty = true;
      this.sendError(conn, 'internal');
      return;
    }
    const event: RoomEvent = {
      type: 'control',
      auctionId: this.auctionId,
      seq,
      ts,
      controlId: cmd.controlId,
      action: cmd.action,
      by: conn.sub,
      ...(cmd.args ? { args: cmd.args } : {}),
      audit: {
        bidId: this.deps.ids.mint<'BidId'>(),
        bidderId: this.deps.ids.mint<'BidderId'>(),
        source: 'manual',
        outcome: 'accepted',
        reason: `control:${cmd.action}`,
        serverTs: ts,
        seq,
      },
    };
    try {
      await this.appendFenced(this.auctionId, this.seq, [event]);
    } catch {
      await this.recover().catch(() => undefined);
      this.sendError(conn, this.storeCode());
      return;
    }
    this.seq = seq;
    this.controlIds.add(cmd.controlId);
    // The new deadline or state reaches clients in the price message; its seq leaves no gap.
    this.broadcastPrice(seq, ts);
    this.armTimer();
    try {
      await this.makeDurable();
    } catch {
      this.sendError(conn, this.storeCode());
    }
  }

  /** Applies a clock control to the engine; `open` only checks the lot is open. Shared by live and replay. */
  private applyClock(
    engine: EnginePort,
    action: ControlCommand['action'],
    ts: EpochMs,
    extraMs: number | undefined,
  ): void {
    if (!canClock(engine)) throw new GavelError('internal', 'engine has no clock controls');
    if (action === 'pause') engine.pause(ts);
    else if (action === 'resume') engine.resume(ts);
    else if (action === 'extend' && extraMs !== undefined) engine.extend(ts, extraMs);
  }

  /**
   * Cancels the open lot because the payments kill switch is engaged (R-PAY-037): the room
   * ends as an unsold hammer, so settlement voids every hold. Returns false when the room
   * was already hammered or finished. Safe to repeat.
   */
  abort(by: string): Promise<boolean> {
    return this.enqueue(async () => {
      try {
        await this.ensureClean();
      } catch {
        throw this.storeError();
      }
      if (this.hammered || this.done) return false;
      await this.doHammer(undefined, { by });
      return this.hammered !== undefined;
    });
  }

  /**
   * A bidder's hold can no longer be charged: revoke their ceiling before the hammer so
   * nobody has to outbid a leader who cannot pay. The revoke is a log event, so a rebuilt
   * room reproduces it. `hammered` means the room is past that point and the settlement
   * bridge handles the hold instead. Idempotent; the ledger is written on every call.
   */
  revokeBidder(bidderId: BidderId, reason: RevokeReason, holdRef?: string): Promise<RevokeOutcome> {
    return this.enqueue(async () => {
      try {
        await this.ensureClean();
      } catch {
        throw this.storeError();
      }
      if (this.hammered) return 'hammered';
      // A hold that is not the registered one does not back the ceiling (R-ENG-044).
      const registered = this.roster.get(bidderId)?.holdRef;
      if (holdRef !== undefined && registered !== undefined && registered !== holdRef) {
        return 'noop';
      }
      if (!this.roster.has(bidderId) || this.revoked.has(bidderId)) {
        await this.makeDurable();
        return 'noop';
      }
      const engine = this.requireEngine();
      if (!canRevoke(engine)) throw new GavelError('internal', 'engine cannot revoke');
      const seq = this.seq + 1;
      const ts = this.deps.clock.now();
      try {
        engine.revoke(bidderId, reason, ts);
      } catch {
        this.dirty = true;
        throw new GavelError('internal');
      }
      const event: RoomEvent = {
        type: 'ceiling_revoked',
        auctionId: this.auctionId,
        seq,
        ts,
        bidderId,
        reason,
      };
      try {
        await this.appendFenced(this.auctionId, this.seq, [event]);
      } catch {
        await this.recover().catch(() => undefined);
        throw this.storeError();
      }
      this.seq = seq;
      this.revoked.add(bidderId);
      // The leader may have changed; the price message carries the new seq, so no one sees a gap.
      this.armTimer();
      this.broadcastPrice(seq, ts);
      await this.makeDurable();
      return 'applied';
    });
  }

  /** Writes what the room log holds into the engine ledger (host hook); throws when it is not durable. */
  private async makeDurable(): Promise<void> {
    const engine = this.engine;
    if (this.deps.durable && engine) await this.deps.durable(this.auctionId, engine);
  }

  /** Append the hammer (with its control record when the auctioneer asked), broadcast it, then settle. */
  private async doHammer(
    by: { conn: Connection; cmd: ControlCommand } | undefined,
    abort?: { by: string },
  ): Promise<void> {
    if (this.hammered) return;
    const engine = this.requireHammer();
    const ts = this.deps.clock.now();
    let result: HammerResult;
    try {
      if (abort !== undefined) {
        if (!canAbort(engine)) throw new GavelError('internal', 'engine cannot abort');
        result = engine.abort(ts);
      } else {
        result = engine.hammer(ts);
      }
    } catch (e) {
      if (e instanceof GavelError && e.code === 'conflict') {
        // A refused command leaves the engine untouched: a normal refusal, no rebuild.
        if (by) this.sendError(by.conn, 'conflict');
        return;
      }
      // The engine may be half-mutated: rebuild from the log before the next command (R-RT-033).
      this.dirty = true;
      if (by) this.sendError(by.conn, 'internal');
      return;
    }
    const first = this.seq + 1;
    const events: RoomEvent[] = [];
    const control = by
      ? {
          controlId: by.cmd.controlId,
          by: by.conn.sub,
          ...(by.cmd.args ? { args: by.cmd.args } : {}),
        }
      : abort
        ? { controlId: abortControlId(this.auctionId), by: abort.by, args: { abort: 1 } }
        : undefined;
    if (control) {
      const bidId = this.deps.ids.mint<'BidId'>();
      events.push({
        type: 'control',
        auctionId: this.auctionId,
        seq: first,
        ts,
        controlId: control.controlId,
        action: 'hammer',
        by: control.by,
        ...(control.args ? { args: control.args } : {}),
        audit: {
          bidId,
          bidderId: this.deps.ids.mint<'BidderId'>(),
          source: 'manual',
          outcome: 'accepted',
          reason: abort ? 'control:abort' : `control:${by?.cmd.action ?? 'hammer'}`,
          serverTs: ts,
          seq: first,
        },
      });
    }
    const hammerSeq = first + events.length;
    events.push({
      type: 'hammered',
      auctionId: this.auctionId,
      seq: hammerSeq,
      ts,
      winnerId: result.winnerId,
      price: result.price,
      ranking: result.ranking,
    });
    try {
      await this.appendFenced(this.auctionId, this.seq, events);
    } catch {
      await this.recover().catch(() => undefined);
      if (by) this.sendError(by.conn, this.storeCode());
      return;
    }
    this.cancelTimer?.();
    this.cancelTimer = undefined;
    this.cancelHammer?.();
    this.cancelHammer = undefined;
    if (control) {
      this.controlIds.add(control.controlId);
      // The control record consumed a seq nobody else can see; carry it so clients see no gap (R-RT-036).
      this.seq = first;
      for (const conn of this.conns.values()) this.sendSeqFiller(conn, first, ts);
    }
    this.seq = hammerSeq;
    this.lastState = 'SETTLING';
    this.hammered = { ...result, seq: hammerSeq, ts };
    for (const conn of this.conns.values()) this.sendHammer(conn, this.hammered);
    await this.requestSettle();
  }

  private sendHammer(conn: Connection, h: HammerResult & { seq: number; ts: number }): void {
    this.send(conn, {
      v: 1,
      t: 'hammer',
      seq: h.seq,
      ts: h.ts as ReturnType<Clock['now']>,
      winnerId: h.winnerId,
      price: h.price,
      ranking: h.ranking,
    });
  }

  /** Persist the settle request, then hand the outcome to payments once per process (R-RT-051). */
  private async requestSettle(): Promise<void> {
    const hammered = this.hammered;
    const settle = this.deps.settle;
    if (!hammered || !settle || this.done || this.settleCalled) return;
    if (!this.settleRequested) {
      const seq = this.seq + 1;
      const ts = this.deps.clock.now();
      try {
        await this.appendFenced(this.auctionId, this.seq, [
          { type: 'settle_requested', auctionId: this.auctionId, seq, ts },
        ]);
      } catch {
        await this.recover().catch(() => undefined);
        return;
      }
      this.seq = seq;
      this.settleRequested = true;
      for (const conn of this.conns.values()) this.sendSeqFiller(conn, seq, ts);
    }
    this.settleCalled = true;
    try {
      await settle.settle(this.auctionId, {
        winnerId: hammered.winnerId,
        price: hammered.price,
        ranking: hammered.ranking,
      });
    } catch {
      // Not lost: a restart resumes settlement from the log (R-RT-060).
      this.settleCalled = false;
    }
  }

  /** After a restart: a hammered room that is not settled calls payments again (R-RT-060). */
  private resumeSettlement(): Promise<void> {
    return this.enqueue(() => this.requestSettle());
  }

  /** Drive a hammered room's settlement again: store a missing request and call payments. */
  retrySettlement(): Promise<void> {
    return this.resumeSettlement();
  }

  /**
   * Settlement progress from payments (R-RT-052): validated, ordered by `rev` (stale or
   * repeated revs are dropped), persisted, then broadcast. DONE only on a terminal state (R-RT-053).
   */
  reportSettlement(report: SettlementReport): Promise<void> {
    return this.enqueue(async () => {
      try {
        await this.ensureClean();
      } catch {
        throw this.storeError();
      }
      if (!this.hammered) throw new GavelError('conflict', 'auction is not hammered');
      if (this.settlement && report.rev <= this.settlement.rev) return;
      const seq = this.seq + 1;
      const ts = this.deps.clock.now();
      const event = RoomEventSchema.safeParse({
        type: 'settlement_update',
        auctionId: this.auctionId,
        seq,
        ts,
        rev: report.rev,
        auctionState: report.auctionState,
        perBidder: report.perBidder,
        ...(report.amountCaptured !== undefined ? { amountCaptured: report.amountCaptured } : {}),
        ...(report.note !== undefined ? { note: report.note } : {}),
      });
      if (!event.success) throw new GavelError('bad_message', 'invalid settlement update');
      try {
        await this.appendFenced(this.auctionId, this.seq, [event.data]);
      } catch {
        await this.recover().catch(() => undefined);
        throw this.storeError();
      }
      this.seq = seq;
      this.applySettlement(report);
      for (const conn of this.conns.values()) {
        const you = conn.bidderId ? report.perBidder[conn.bidderId] : undefined;
        this.send(conn, {
          v: 1,
          t: 'settlement_update',
          seq,
          ts,
          rev: report.rev,
          auctionState: report.auctionState,
          ...(you ? { you } : {}),
          ...(report.amountCaptured !== undefined ? { amountCaptured: report.amountCaptured } : {}),
          ...(report.note !== undefined ? { note: report.note } : {}),
        });
      }
    });
  }

  /** While paused the deadline moves with the clock: now plus what resume will restore. */
  private endTsFor(view: EngineView, now: ReturnType<Clock['now']>): typeof view.endTs {
    return view.paused ? ((now + (view.remainingMs ?? 0)) as typeof view.endTs) : view.endTs;
  }

  private broadcastPrice(seq: number, ts: ReturnType<Clock['now']>): void {
    const view = this.requireEngine().view();
    if (view.price === null) {
      // No price frame can express "no bids" (R-RT-036): send a snapshot so seq stays gapless.
      for (const conn of this.conns.values()) this.sendState(conn);
      return;
    }
    const leaderPaddle = view.leader ? (this.roster.get(view.leader)?.paddle ?? null) : null;
    for (const conn of this.conns.values()) {
      this.send(conn, {
        v: 1,
        t: 'price',
        seq,
        ts,
        price: view.price,
        leaderId: view.leader,
        leaderPaddle,
        endTs: this.endTsFor(view, ts),
        minNext: view.minNext,
        extensions: view.extensions,
        ...(view.paused ? { paused: true, remainingMs: view.remainingMs ?? 0 } : {}),
      });
    }
  }

  private broadcastAudit(audit: AuditPayload, seq: number, ts: ReturnType<Clock['now']>): void {
    const frame: ServerMsg = { v: 1, t: 'audit_event', seq, ts, audit };
    for (const conn of this.conns.values()) {
      if (redactForViewer(conn.role, conn.bidderId, frame) === null) {
        // This viewer may not see the row, but the seq was consumed: carry it with a frame that
        // leaves their view unchanged, so they do not see a gap and resync (R-RT-036).
        this.sendSeqFiller(conn, seq, ts);
        continue;
      }
      this.send(conn, frame);
    }
  }

  private sendSeqFiller(conn: Connection, seq: number, ts: ReturnType<Clock['now']>): void {
    const view = this.requireEngine().view();
    if (view.price === null) {
      this.sendState(conn);
      return;
    }
    const leaderPaddle = view.leader ? (this.roster.get(view.leader)?.paddle ?? null) : null;
    this.send(conn, {
      v: 1,
      t: 'price',
      seq,
      ts,
      price: view.price,
      leaderId: view.leader,
      leaderPaddle,
      endTs: view.endTs,
      minNext: view.minNext,
      extensions: view.extensions,
    });
  }

  private snapshotFor(conn: Connection): RoomSnapshot {
    const config = this.config;
    if (!config) throw new GavelError('internal', 'room has no config');
    const view = this.requireEngine().view();
    const you = conn.bidderId ? this.roster.get(conn.bidderId) : undefined;
    const snapshot: RoomSnapshot = {
      auctionId: this.auctionId,
      config,
      status: this.done ? 'DONE' : view.state,
      price: view.price,
      leaderId: view.leader,
      endTs: this.endTsFor(view, this.deps.clock.now()),
      minNext: view.minNext,
      ...(view.paused ? { paused: true, remainingMs: view.remainingMs ?? 0 } : {}),
      roster: [...this.roster].map(([bidderId, r]) => ({
        bidderId,
        paddle: r.paddle,
        name: r.name,
        hold: this.revoked.has(bidderId) ? ('NONE' as const) : ('HELD' as const),
      })),
      recentAudit: [...this.audit],
    };
    if (this.settlement) {
      const own = conn.bidderId ? this.settlement.perBidder[conn.bidderId] : undefined;
      snapshot.settlement = {
        rev: this.settlement.rev,
        auctionState: this.settlement.auctionState,
        ...(own ? { you: own } : {}),
      };
    }
    if (conn.bidderId && you) snapshot.you = { bidderId: conn.bidderId, ceiling: you.ceiling };
    return snapshot;
  }

  private sendState(conn: Connection): void {
    this.send(conn, {
      v: 1,
      t: 'state',
      seq: Math.max(1, this.seq),
      ts: this.deps.clock.now(),
      snapshot: this.snapshotFor(conn),
    });
  }

  /** Redact for the viewer, encode and hand to the transport. Frames that fail to encode are dropped. */
  private send(conn: Connection, msg: ServerMsg): void {
    const out = redactForViewer(conn.role, conn.bidderId, msg);
    if (out === null) return;
    const enc = encodeMsg(out);
    if (!enc.ok) {
      this.encodeFailures += 1;
      return;
    }
    try {
      conn.transport.send(enc.value);
    } catch {
      // A dead socket must not stop the fan-out to the others: drop only this connection.
      this.conns.delete(conn.id);
    }
  }

  private sendError(conn: Connection, code: ErrorCode, retryAfterMs?: number): void {
    const msg: ServerMsg = { v: 1, t: 'error', code, message: code };
    if (retryAfterMs !== undefined) msg.retryAfterMs = retryAfterMs;
    this.send(conn, msg);
  }

  /** Re-arm the close timer for the engine's current endTs (R-RT-041). */
  private armTimer(): void {
    this.cancelTimer?.();
    this.cancelTimer = undefined;
    this.cancelHammer?.();
    this.cancelHammer = undefined;
    this.cancelTimerRetry?.();
    this.cancelTimerRetry = undefined;
    if (this.stopped) return;
    const view = this.engine?.view();
    if (!view || this.hammered || this.closed) return;
    if (view.state === 'CLOSING') {
      this.armAutoHammer();
      return;
    }
    if (view.state !== 'OPEN') return;
    const engine = this.engine;
    if (engine && canClock(engine) && engine.paused) return;
    this.cancelTimer = this.deps.clock.setTimer(view.endTs, () => {
      this.enqueue(() => this.onTimer()).catch(() => {
        // A throwing timer body must not become an unhandled rejection; rebuild on the next
        // command, and try the end of the lot again soon in case no command comes (R-RT-041).
        this.dirty = true;
        this.retryTimer();
      });
    });
  }

  /** The end-of-lot timer could not run (store down): try again after a short delay. */
  private retryTimer(): void {
    if (this.stopped || this.closed || this.hammered || this.done) return;
    this.cancelTimerRetry?.();
    this.cancelTimerRetry = this.deps.clock.setTimer(
      this.deps.clock.now() + AUTO_HAMMER_RETRY_MS,
      () => {
        this.cancelTimerRetry = undefined;
        if (this.closed || this.stopped) return;
        this.enqueue(() => this.onTimer()).catch(() => {
          this.dirty = true;
          this.retryTimer();
        });
      },
    );
  }

  /** Schedule the hammer `autoHammerDelayMs` after CLOSING began, if the config asks for it (R-RT-044). */
  private armAutoHammer(): void {
    if (this.stopped) return;
    const delay = this.config?.autoHammerDelayMs;
    if (delay === undefined || this.closingAt === undefined) return;
    this.cancelHammer = this.deps.clock.setTimer(this.closingAt + delay, () => {
      this.enqueue(() => this.onAutoHammer()).catch(() => {
        this.dirty = true;
      });
    });
  }

  private async onAutoHammer(): Promise<void> {
    try {
      await this.ensureClean();
    } catch {
      // The store is down at the due time: try again soon instead of losing the hammer.
      this.retryAutoHammer();
      return;
    }
    if (this.hammered || this.closingAt === undefined) return;
    const due = this.closingAt + (this.config?.autoHammerDelayMs ?? 0);
    if (this.deps.clock.now() < due) {
      this.armTimer();
      return;
    }
    try {
      await this.doHammer(undefined);
    } finally {
      if (!this.hammered && !this.done) this.retryAutoHammer();
    }
  }

  private retryAutoHammer(): void {
    if (this.stopped) return;
    this.cancelHammer?.();
    this.cancelHammer = this.deps.clock.setTimer(
      this.deps.clock.now() + AUTO_HAMMER_RETRY_MS,
      () => {
        this.enqueue(() => this.onAutoHammer()).catch(() => {
          this.dirty = true;
        });
      },
    );
  }

  private async onTimer(): Promise<void> {
    try {
      await this.ensureClean();
    } catch {
      this.retryTimer();
      return;
    }
    const engine = this.requireEngine();
    const now = this.deps.clock.now();
    const endTs = engine.view().endTs;
    if (now < endTs) {
      this.armTimer();
      return;
    }
    const from = this.lastState;
    const to = engine.tick(now);
    if (to === from) {
      // Past endTs but the engine has not moved: try again soon rather than stay OPEN (R-RT-041).
      this.retryTimer();
      return;
    }
    const seq = this.seq + 1;
    const event: RoomEvent = {
      type: 'state_changed',
      auctionId: this.auctionId,
      seq,
      ts: now,
      from,
      to,
      endTs,
    };
    try {
      await this.appendFenced(this.auctionId, this.seq, [event]);
    } catch {
      await this.recover().catch(() => undefined);
      this.retryTimer();
      return;
    }
    this.seq = seq;
    this.lastState = to;
    if (to === 'CLOSING') this.closingAt = now;
    for (const conn of this.conns.values()) this.sendState(conn);
    this.armTimer();
  }

  /**
   * Rebuild after a failed append so engine state matches the stored log. The
   * rebuild happens off to the side and is adopted only if it fully succeeds; if
   * the store is still down the room stays dirty and retries on the next command.
   */
  private async recover(): Promise<void> {
    this.dirty = true;
    await this.ensureClean();
  }

  private async ensureClean(): Promise<void> {
    if (this.stopped) throw new GavelError('host_fenced');
    if (!this.dirty) return;
    const fresh = new Room(this.auctionId, this.deps);
    try {
      await fresh.replay();
    } catch {
      throw new GavelError('store_unavailable');
    }
    // A log longer than what clients were told means an append committed after it failed.
    const moved = fresh.seq !== this.seq;
    this.config = fresh.config;
    this.engine = fresh.engine;
    this.roster = fresh.roster;
    this.replies = fresh.replies;
    this.audit = fresh.audit;
    this.seq = fresh.seq;
    this.bidCount = fresh.bidCount;
    this.lastState = fresh.lastState;
    this.closingAt = fresh.closingAt;
    this.controlIds = fresh.controlIds;
    this.hammered = fresh.hammered;
    this.revoked = fresh.revoked;
    this.settleRequested = fresh.settleRequested;
    this.settlement = fresh.settlement;
    this.done = fresh.done;
    this.dirty = false;
    this.armTimer();
    // Tell everyone about events they never saw: resend the state (R-RT-056).
    if (moved) for (const conn of this.conns.values()) this.sendState(conn);
  }

  private async replay(): Promise<void> {
    this.config = undefined;
    this.engine = undefined;
    this.roster = new Map();
    this.replies = new Map();
    this.audit = [];
    this.seq = 0;
    this.bidCount = 0;
    this.lastState = 'OPEN';
    this.closingAt = undefined;
    this.controlIds = new Set();
    this.openConfirms = new Map();
    this.acceptedWithoutBid = new Map();
    this.hammered = undefined;
    this.abortPending = false;
    this.revoked = new Set();
    this.settleRequested = false;
    this.settlement = undefined;
    this.done = false;
    let from = 1;
    for (;;) {
      const page = await this.deps.store.readEvents(this.auctionId, from, READ_PAGE);
      for (const event of page) this.apply(event);
      if (page.length < READ_PAGE) break;
      from += READ_PAGE;
    }
    if (!this.config) throw new GavelError('not_found', 'auction has no events');
  }

  private apply(event: RoomEvent): void {
    this.seq = event.seq;
    switch (event.type) {
      case 'auction_created':
        this.config = event.config;
        this.engine = this.deps.engine(event.config, event.ts);
        break;
      case 'bidder_registered':
        try {
          this.applyRegistered(event);
        } catch {
          // A registration the engine refuses (written by an older build) must not brick the load.
          // The roster stays without this bidder, matching the engine.
        }
        break;
      case 'bid_accepted':
        placeBidOn(this.requireEngine(), event.bidderId, event.amount, event.ts, {
          source: event.audit.source,
          ...(event.audit.transcript !== undefined ? { transcript: event.audit.transcript } : {}),
          ...(event.audit.confidence !== undefined ? { confidence: event.audit.confidence } : {}),
          ...(event.audit.confirmed === true ? { confirmed: true } : {}),
        });
        this.remember(event);
        break;
      case 'bid_rejected':
        this.remember(event);
        break;
      case 'state_changed':
        this.requireEngine().tick(event.ts);
        this.lastState = event.to;
        if (event.to === 'CLOSING') this.closingAt = event.ts;
        break;
      case 'control':
        this.controlIds.add(event.controlId);
        if (event.action !== 'hammer' && event.action !== 'open') {
          try {
            this.applyClock(this.requireEngine(), event.action, event.ts, event.args?.extraMs);
          } catch {
            // The engine refused what the live room accepted (older build); keep loading.
          }
        }
        if (event.controlId === abortControlId(this.auctionId)) this.abortPending = true;
        break;
      case 'ceiling_revoked':
        if (this.roster.has(event.bidderId)) {
          const engine = this.requireEngine();
          if (canRevoke(engine)) engine.revoke(event.bidderId, event.reason, event.ts);
        }
        this.revoked.add(event.bidderId);
        break;
      case 'hammered': {
        const engine = this.requireHammer();
        const result =
          this.abortPending && canAbort(engine) ? engine.abort(event.ts) : engine.hammer(event.ts);
        this.hammered = { ...result, seq: event.seq, ts: event.ts };
        this.lastState = 'SETTLING';
        break;
      }
      case 'settle_requested':
        this.settleRequested = true;
        break;
      case 'confirm_requested':
        this.openConfirms.set(event.confirmId, {
          confirmId: event.confirmId,
          bidderId: event.bidderId,
          mid: event.mid,
          amount: event.amount,
          ...(event.audit.transcript !== undefined ? { transcript: event.audit.transcript } : {}),
          ...(event.audit.confidence !== undefined ? { confidence: event.audit.confidence } : {}),
          expiresAt: event.expiresAt,
        });
        break;
      case 'confirm_resolved': {
        const held = this.openConfirms.get(event.confirmId);
        this.openConfirms.delete(event.confirmId);
        if (held !== undefined && event.outcome === 'accepted') {
          this.acceptedWithoutBid.set(`${held.bidderId}:${held.mid}`, held);
        }
        break;
      }
      case 'settlement_update':
        this.applySettlement(event);
        break;
      default:
        break;
    }
  }

  private applyRegistered(event: Extract<RoomEvent, { type: 'bidder_registered' }>): void {
    this.requireEngine().register(event.bidderId, event.ceiling);
    this.roster.set(event.bidderId, {
      paddle: event.paddle,
      name: event.name,
      ceiling: event.ceiling,
      holdRef: event.holdRef,
    });
  }

  private remember(event: Extract<RoomEvent, { type: 'bid_accepted' | 'bid_rejected' }>): void {
    if (event.type === 'bid_accepted') this.bidCount += 1;
    this.acceptedWithoutBid.delete(`${event.bidderId}:${event.mid}`);
    const reply = this.replyFor(event);
    if (reply) {
      const digest = bidDigest(event.audit.parsedAmount, event.audit.source);
      this.replies.set(`${event.bidderId}:${event.mid}`, { reply, digest });
    }
    this.pushAudit(event.audit);
  }

  private pushAudit(audit: AuditPayload): void {
    this.audit.push(audit);
    if (this.audit.length > RECENT_AUDIT) this.audit.shift();
  }

  private requireHammer(): HammerEnginePort {
    const engine = this.requireEngine();
    if (!canHammer(engine)) throw new GavelError('internal', 'engine cannot hammer');
    return engine;
  }

  private applySettlement(report: SettlementReport): void {
    this.settlement = {
      rev: report.rev,
      auctionState: report.auctionState,
      perBidder: report.perBidder,
      ...(report.amountCaptured !== undefined ? { amountCaptured: report.amountCaptured } : {}),
      ...(report.note !== undefined ? { note: report.note } : {}),
    };
    if (TERMINAL_SETTLEMENT.includes(report.auctionState)) {
      this.done = true;
      this.lastState = 'DONE';
    }
  }

  private requireEngine(): EnginePort {
    if (!this.engine) throw new GavelError('internal', 'room is not loaded');
    return this.engine;
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new GavelError('conflict', 'room is closed'));
    this.queued += 1;
    const run = this.tail.then(async () => {
      this.inFlight += 1;
      this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
      try {
        return await fn();
      } finally {
        this.inFlight -= 1;
        this.queued -= 1;
      }
    });
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
