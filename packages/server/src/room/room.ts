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
  type SettlementState,
  type Transport,
} from '@gavel/shared';
import { authorize, redactForViewer } from '../auth/authorize';
import { SnapshotPolicy } from './snapshot-policy';
import { connectionTokenLive } from '../auth/auctioneer-floor';
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
  /** Facts of the token the socket joined with, re-checked on rotate, revoke and expiry. */
  token?: { jti: string; iat: number; exp: number; kind: string };
}

/** Read-only room facts for the voice adapter (see Room.voiceView). */
export interface VoiceView {
  open: boolean;
  price: Cents;
  minNext: Cents;
  minIncrement: Cents;
  leader: BidderId | null;
  confirmThreshold: number;
  roster: Array<{ bidderId: BidderId; paddle: string }>;
}

/** What a mid is bound to: the amount and the effective source (manual for the auctioneer). */
function bidDigest(amount: unknown, source: string): string {
  return `${isCents(amount) ? amount : ''}|${source}`;
}

/** True when the text holds a control character (U+0000 to U+001F); Postgres jsonb refuses NUL. */
function hasControlChar(text: string): boolean {
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) < 0x20) return true;
  return false;
}

/** The text without control characters, so every store receives the same input. */
function stripControlChars(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) >= 0x20) out += text[i];
  return out;
}

/** The source and audit fields of a bid as the room records them, live and on replay. */
function bidMeta(conn: Connection, msg: BidMsg, confirmed = false, manualBy?: string): BidMeta {
  const by = manualBy ?? (conn.role === 'auctioneer' ? conn.sub : undefined);
  if (by !== undefined) {
    const meta: BidMeta = {
      source: 'manual',
      transcript: `manual by ${by}`.slice(0, 120),
    };
    if (confirmed) meta.confirmed = true;
    return meta;
  }
  // A bidder frame may claim qr or voice only; manual is the auctioneer's entry (R-RT-039).
  const meta: BidMeta = { source: isVoiceLike(msg) ? 'voice' : 'qr' };
  if (msg.transcript !== undefined) meta.transcript = stripControlChars(msg.transcript);
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

/** Reason an auctioneer's manual bid is refused with when it is over the bidder's ceiling. */
const MANUAL_REFUSED: ErrorCode = 'limit_exceeded';

/** Most manual bids one auctioneer token may enter in a lot; each also needs the bidder's confirmation. */
export const MAX_MANUAL_BIDS_PER_LOT = 25;

/** The auctioneer subject of a manual audit row (`manual by <sub>`), or undefined for any other. */
function manualSubject(audit: AuditPayload): string | undefined {
  const prefix = 'manual by ';
  if (audit.source !== 'manual' || audit.transcript?.startsWith(prefix) !== true) return undefined;
  return audit.transcript.slice(prefix.length);
}

type Reply = Extract<ServerMsg, { t: 'bid_accepted' | 'bid_rejected' }>;

const READ_PAGE = 1000;
const RECENT_AUDIT = 50;
/** Bid replies kept for idempotent replay; older ones fall out. */
const MAX_REPLIES = 10_000;
/** Most voice holds one bidder may request in a lot (RT4-sec-03). */
const MAX_HOLDS_PER_BIDDER = 50;
const AUTO_HAMMER_RETRY_MS = 2_000;

/** The control id of a kill-switch abort; one per auction, so a repeat is a no-op. */
const ABORT_AUDIT_REASON = 'control:abort';

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
  /** Rejected bids in the log; bounded by `caps.bidsPerAuction` too (R12-S05). */
  private rejectedCount = 0;
  /** Voice holds requested per bidder; capped so one paddle cannot grow the log (RT4-sec-03). */
  private holdsBy = new Map<BidderId, number>();
  private config: AuctionConfig | undefined;
  private engine: EnginePort | undefined;
  private lastState = 'OPEN';
  private roster = new Map<BidderId, RosterEntry>();
  /** Each bidder's highest accepted amount, so a snapshot can restore their own high bid. */
  private highBids = new Map<BidderId, Cents>();
  private replies = new Map<string, { reply: Reply; digest: string }>();
  private audit: AuditPayload[] = [];
  private readonly conns = new Map<ConnId, Connection>();
  private cancelTimer: CancelTimer | undefined;
  private cancelHammer: CancelTimer | undefined;
  /** When the room entered CLOSING; the auto-hammer delay counts from here (R-RT-044). */
  private closingAt: number | undefined;
  /** Control id to the action it was first used for; reuse for another action is a conflict. */
  private controlIds = new Map<string, string>();
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
  /** True when the auctioneer (control or kill switch) ended the lot rather than the timer. */
  private endedByAuctioneer = false;
  private revoked = new Set<BidderId>();
  private settlement: SettlementReport | undefined;
  private done = false;
  /** True when the engine may be ahead of the stored log and must be rebuilt first. */
  private dirty = false;
  /** Set when this host lost the room; the room serves nothing and arms no timer. */
  private stopped = false;
  private snapshotPolicy: SnapshotPolicy | undefined;
  /** Manual bids each auctioneer token has asked a bidder to confirm in this lot (#1751). */
  private manualCounts = new Map<string, number>();
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

  /**
   * Close every open socket whose token is no longer good (rotated or revoked auctioneer
   * token, denied jti, expired). Called after the token routes write the store. Returns how
   * many sockets were closed.
   */
  async dropDeadTokens(): Promise<number> {
    let dropped = 0;
    for (const conn of [...this.conns.values()]) {
      const token = conn.token;
      if (token === undefined || conn.internal === true) continue;
      const live = await connectionTokenLive(
        this.deps.store,
        this.auctionId,
        token,
        this.deps.clock.now(),
      );
      if (live || !this.conns.delete(conn.id)) continue;
      dropped++;
      conn.transport.close(ERROR_TABLE.unauthorized.closeCode ?? 4401, 'unauthorized');
    }
    return dropped;
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
      await this.maybeSnapshot(auctionId, events);
    } catch (e) {
      if (e instanceof GavelError && e.code === 'conflict') {
        this.fence();
        throw new GavelError('host_fenced', 'this host no longer owns the room');
      }
      throw e;
    }
  }

  /** Saves a snapshot when the policy says so (every 100 events); best effort, never fails a command. */
  private async maybeSnapshot(auctionId: AuctionId, events: RoomEvent[]): Promise<void> {
    const last = events[events.length - 1];
    if (!last) return;
    this.snapshotPolicy ??= new SnapshotPolicy(this.deps.store, auctionId);
    await this.snapshotPolicy.afterCommit(last.seq, false, () => ({
      seq: last.seq,
      savedAt: this.deps.clock.now(),
      bidders: this.roster.size,
    }));
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
        hasControlChar(name) ||
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
    // An auctioneer has no bidder id; its bucket follows the token holder, so opening a new
    // socket does not give a fresh allowance.
    const limited = this.deps.limiter?.checkBid(conn.bidderId ?? `${conn.role}:${conn.sub}`);
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

  /**
   * Facts the voice adapter needs to judge a spoken bid. Ceilings stay inside the room: the
   * adapter sees paddles and bidder ids only, and the engine remains the judge of every bid.
   */
  voiceView(): VoiceView | undefined {
    const engine = this.engine;
    if (engine === undefined || this.config === undefined) return undefined;
    const view = engine.view();
    return {
      open: view.state === 'OPEN' && !this.hammered,
      price: view.price ?? (0 as Cents),
      minNext: view.minNext,
      minIncrement: this.config.minIncrement,
      leader: view.leader,
      confirmThreshold: this.config.confirmConfidenceThreshold,
      roster: [...this.roster].map(([bidderId, r]) => ({ bidderId, paddle: String(r.paddle) })),
    };
  }

  /**
   * Submit a bid the voice adapter heard for a registered bidder. Room mic design: the audio
   * token is the auctioneer's, the bidder is the spoken paddle. The throwaway connection has
   * the bidder role, so it can only place a bid; `internal` skips just the connection cap and
   * supersede. It takes the same path as a bid the bidder sent with source voice: the rate
   * limit, the confidence gate and the confirm hold apply, and the engine decides last. The
   * reply goes nowhere because no socket belongs to this call.
   */
  submitVoiceBid(bidderId: BidderId, msg: BidMsg): Promise<void> {
    const sink: Transport = { send: () => undefined, close: () => undefined };
    const conn: Connection = {
      id: this.deps.ids.mint<'ConnId'>() as ConnId,
      role: 'bidder',
      bidderId,
      sub: bidderId,
      transport: sink,
      internal: true,
    };
    return this.submitBid(conn, { ...msg, source: 'voice' });
  }

  /**
   * Record a spoken utterance that never became a bid or a confirm (hedged, no bidder). The
   * event takes a seq of its own and is not broadcast; the transcript is never stored.
   */
  recordVoiceDrop(drop: Extract<RoomEvent, { type: 'voice_dropped' }>['drop']): Promise<void> {
    return this.enqueue(async () => {
      if (this.stopped || this.done) return;
      try {
        await this.ensureClean();
      } catch {
        return;
      }
      const seq = this.seq + 1;
      const ts = this.deps.clock.now();
      const event: RoomEvent = { type: 'voice_dropped', auctionId: this.auctionId, seq, ts, drop };
      try {
        await this.appendFenced(this.auctionId, this.seq, [event]);
      } catch {
        await this.recover().catch(() => undefined);
        return;
      }
      this.seq = seq;
      // The record consumed a seq nobody sees; carry it so clients see no gap (R-RT-036).
      for (const conn of this.conns.values()) this.sendSeqFiller(conn, seq, ts);
      await this.makeDurable();
    });
  }

  private async handleBid(
    conn: Connection,
    msg: BidMsg,
    bidderId: BidderId,
    hold?: PendingConfirm,
  ): Promise<void> {
    const confirmed = hold !== undefined;
    // A manual bid is entered by the auctioneer and only placed after the bidder confirms it.
    const manualBy = hold?.manualBy ?? (conn.role === 'auctioneer' ? conn.sub : undefined);
    const key = `${bidderId}:${msg.mid}`;
    const prior = this.replies.get(key);
    if (
      prior &&
      prior.digest !== bidDigest(msg.amount, bidMeta(conn, msg, false, manualBy).source)
    ) {
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
      conn.role === 'auctioneer' &&
      this.config !== undefined &&
      isCents(msg.amount) &&
      this.roster.has(bidderId) &&
      !this.hammered &&
      engine.view().state === 'OPEN' &&
      msg.amount <= engine.view().minNext
    ) {
      // No bid is placed for a bidder who has not agreed: ask them first (#1751). The number of
      // manual bids one auctioneer may enter in a lot is capped, so a leaked token cannot walk a
      // bidder up their ceiling.
      if ((this.manualCounts.get(conn.sub) ?? 0) >= MAX_MANUAL_BIDS_PER_LOT) {
        this.sendError(conn, 'limit_exceeded');
        return;
      }
      await this.holdForConfirm(msg, bidderId, conn.sub);
      return;
    }
    if (
      !confirmed &&
      conn.role === 'bidder' &&
      this.config !== undefined &&
      isCents(msg.amount) &&
      this.roster.has(bidderId) &&
      !this.hammered &&
      engine.view().state === 'OPEN' &&
      msg.amount >= engine.view().minNext &&
      needsConfirm(msg, this.config.confirmConfidenceThreshold)
    ) {
      // Holds spend the same budget as logged refusals and a per-bidder one, and past either
      // the bid is answered without a log entry (RT4-sec-03).
      if (
        this.rejectedCount >= this.caps.bidsPerAuction ||
        (this.holdsBy.get(bidderId) ?? 0) >= MAX_HOLDS_PER_BIDDER
      ) {
        this.sendError(conn, 'rate_limited');
        return;
      }
      await this.holdForConfirm(msg, bidderId);
      return;
    }
    const ts = this.deps.clock.now();
    // An accepted confirmation takes the seq before the bid; both land in one append.
    const seq = this.seq + (hold ? 2 : 1);

    let code: ErrorCode | undefined;
    if (!isCents(msg.amount)) code = 'bad_amount';
    else if (!this.roster.has(bidderId)) code = 'unregistered';
    else if (manualBy !== undefined && msg.amount > engine.view().minNext) {
      // A manual bid is limited to the next increment, so a ladder of amounts cannot be used
      // to probe a ceiling (R12-S09). Answered like a ceiling refusal, without logging.
      code = MANUAL_REFUSED;
    } else {
      try {
        const res: unknown = placeBidOn(
          engine,
          bidderId,
          msg.amount,
          ts,
          bidMeta(conn, msg, confirmed, manualBy),
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

    // A refusal that costs nothing to decide is answered to the sender only: no log entry, no
    // seq and no fan-out. Otherwise any joined client could grow the log and fsync at the
    // rate limit (R12-S05). A held-bid acceptance keeps its log entries so the hold resolves.
    const unlogged =
      code === 'auction_paused' ||
      (code === MANUAL_REFUSED && conn.role === 'auctioneer' && !confirmed) ||
      (code !== undefined &&
        !confirmed &&
        (code === 'unregistered' ||
          code === 'bad_amount' ||
          this.rejectedCount >= this.caps.bidsPerAuction));
    if (code !== undefined && unlogged) {
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
    const audit = this.buildAudit(bidId, bidderId, msg, conn, code, ts, seq, confirmed, manualBy);
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

    let resolved: RoomEvent | undefined;
    if (hold) {
      const rSeq = seq - 1;
      resolved = resolvedEvent(
        { auctionId: this.auctionId, seq: rSeq, ts },
        hold.confirmId,
        'accepted',
        confirmAudit(
          hold,
          this.deps.ids.mint<'BidId'>(),
          'accepted',
          CONFIRM_REASON.accepted,
          ts,
          rSeq,
        ),
      );
    }
    try {
      await this.appendFenced(this.auctionId, this.seq, resolved ? [resolved, event] : [event]);
    } catch {
      // State must not change: rebuild the engine from the log and tell the sender. The hold
      // was not consumed, so the bidder can answer the same confirmation again.
      await this.recover().catch(() => undefined);
      this.sendError(conn, this.storeCode());
      return;
    }
    this.seq = seq;
    if (hold && resolved) {
      this.confirms.drop(hold.confirmId);
      this.fanOutConfirm(resolved, hold);
    }
    if (event.type === 'bid_accepted') {
      this.bidCount += 1;
      this.noteHighBid(event.bidderId, event.amount);
    } else this.rejectedCount += 1;
    if (event.type === 'bid_accepted') this.deps.metrics?.bidAccepted();
    else this.deps.metrics?.bidRejected();
    this.pushAudit(audit);
    const reply = this.replyFor(event);
    if (reply) this.keepReply(key, { reply, digest: bidDigest(msg.amount, audit.source) });
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
      if (outcome !== 'accepted') {
        if (!(await this.resolveConfirm(held, outcome))) this.sendError(conn, this.storeCode());
        return;
      }
      const bid: BidMsg = {
        v: 1,
        t: 'bid',
        mid: held.mid,
        amount: held.amount,
        source: held.manualBy !== undefined ? 'manual' : 'voice',
        ...(held.transcript !== undefined ? { transcript: held.transcript } : {}),
        ...(held.confidence !== undefined ? { confidence: held.confidence } : {}),
      };
      // The accepted resolution and the bid are one log append (HRD-23): the hold is only
      // consumed when both are written; a refusal or a store error leaves it in place.
      await this.handleBid(conn, bid, bidderId, held);
    });
  }

  /** Hold a low-confidence or ambiguous voice bid and ask its bidder; the engine is not touched. */
  private async holdForConfirm(msg: BidMsg, bidderId: BidderId, manualBy?: string): Promise<void> {
    const ts = this.deps.clock.now();
    const prior = this.confirms.forBidder(bidderId);
    const held: PendingConfirm = {
      confirmId: this.deps.ids.mint<'ConfirmId'>(),
      bidderId,
      mid: msg.mid,
      amount: msg.amount as Cents,
      ...(manualBy !== undefined
        ? { manualBy }
        : {
            ...(msg.transcript !== undefined
              ? { transcript: stripControlChars(msg.transcript) }
              : {}),
            ...(msg.confidence !== undefined ? { confidence: msg.confidence } : {}),
          }),
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
    this.rejectedCount += 1;
    this.holdsBy.set(bidderId, (this.holdsBy.get(bidderId) ?? 0) + 1);
    if (prior) this.confirms.drop(prior.confirmId);
    if (manualBy !== undefined)
      this.manualCounts.set(manualBy, (this.manualCounts.get(manualBy) ?? 0) + 1);
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
          ...(held.manualBy !== undefined
            ? { transcript: 'Entered for you by the auctioneer' }
            : held.transcript !== undefined
              ? { transcript: held.transcript }
              : {}),
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
    manualBy?: string,
  ): AuditPayload {
    const audit: AuditPayload = {
      bidId,
      bidderId,
      source: bidMeta(conn, msg, false, manualBy).source,
      outcome: code === undefined ? 'accepted' : 'rejected',
      serverTs: ts,
      seq,
    };
    if (isCents(msg.amount)) audit.parsedAmount = msg.amount;
    const meta = bidMeta(conn, msg, confirmed, manualBy);
    if (meta.confirmed) audit.confirmed = true;
    if (meta.transcript !== undefined) audit.transcript = meta.transcript;
    if (meta.confidence !== undefined) audit.confidence = meta.confidence;
    if (meta.source === 'voice') {
      if (msg.audioTsMs !== undefined) audit.audioTsMs = msg.audioTsMs;
      if (msg.audioEndMs !== undefined) audit.audioEndMs = msg.audioEndMs;
    }
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
      // The auctioneer chose the amount of a manual bid, so an over_ceiling refusal would be a
      // ceiling probe (R-RT-055). The precise reason stays in the admin export only.
      const reason: ErrorCode =
        event.reason === 'over_ceiling' && event.audit.source === 'manual'
          ? MANUAL_REFUSED
          : event.reason;
      return {
        v: 1,
        t: 'bid_rejected',
        seq: event.seq,
        ts: event.ts,
        mid: event.mid,
        reason,
        retryable: ERROR_TABLE[reason].retryable,
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
    // `abort:` ids belong to the kill switch; a client must not be able to name one.
    if (cmd.controlId.length === 0 || cmd.controlId.startsWith('abort:')) {
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
      if (this.controlReused(conn, cmd)) return;
      const engine = this.requireEngine();
      const stale = this.staleHammer(engine.view(), cmd.args);
      if (stale !== undefined) {
        // The auctioneer decided on a head that has moved: nothing is hammered or logged.
        this.sendError(conn, 'conflict', undefined, stale);
        return;
      }
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

  /**
   * The hammer carries the price and leader the auctioneer saw (`expectedPriceCents`,
   * `expectedLeaderPaddle`, 0 for no leader). A request without them is applied as before.
   */
  private staleHammer(
    view: EngineView,
    args: Record<string, number> | undefined,
  ): string | undefined {
    const price = args?.expectedPriceCents;
    if (price !== undefined && price !== (view.price ?? 0)) return 'price_changed';
    const paddle = args?.expectedLeaderPaddle;
    if (paddle !== undefined) {
      const now = view.leader ? (this.roster.get(view.leader)?.paddle ?? 0) : 0;
      if (paddle !== now) return 'leader_changed';
    }
    return undefined;
  }

  /** True when the id was used before: a repeat is a no-op, another action under it a conflict. */
  private controlReused(conn: Connection, cmd: ControlCommand): boolean {
    const first = this.controlIds.get(cmd.controlId);
    if (first === undefined) return false;
    if (first !== cmd.action) this.sendError(conn, 'conflict');
    return true;
  }

  private async clockControl(conn: Connection, cmd: ControlCommand): Promise<void> {
    try {
      await this.ensureClean();
    } catch {
      this.sendError(conn, this.storeCode());
      return;
    }
    // A repeat returns the first result and appends nothing (R-RT-050).
    if (this.controlReused(conn, cmd)) return;
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
    this.controlIds.set(cmd.controlId, cmd.action);
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
          reason: abort ? ABORT_AUDIT_REASON : `control:${by?.cmd.action ?? 'hammer'}`,
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
      this.controlIds.set(control.controlId, 'hammer');
      // The control record consumed a seq nobody else can see; carry it so clients see no gap (R-RT-036).
      this.seq = first;
      for (const conn of this.conns.values()) this.sendSeqFiller(conn, first, ts);
    }
    this.seq = hammerSeq;
    this.lastState = 'SETTLING';
    this.endedByAuctioneer = by !== undefined || abort !== undefined;
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
      ...(this.endedByAuctioneer ? { stopped: true } : {}),
      registrationClosed: true,
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
      // The paddle of the captured winner is public, like the hammer that named them.
      const winnerPaddle =
        report.winnerId === undefined
          ? undefined
          : this.roster.get(report.winnerId as BidderId)?.paddle;
      const counts: Partial<Record<SettlementState, number>> = {};
      for (const state of Object.values(report.perBidder)) counts[state] = (counts[state] ?? 0) + 1;
      const ladder = Object.keys(counts).length > 0 ? { counts } : undefined;
      for (const conn of this.conns.values()) {
        const you = conn.bidderId ? report.perBidder[conn.bidderId] : undefined;
        // A bidder's own hold goes to that bidder only, never to a screen or the auctioneer.
        const own =
          conn.role === 'bidder' && conn.bidderId !== undefined
            ? report.holds?.[conn.bidderId]
            : undefined;
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
          ...(winnerPaddle !== undefined ? { winnerPaddle } : {}),
          ...(ladder !== undefined ? { ladder } : {}),
          ...(own !== undefined && conn.bidderId !== undefined
            ? { yourHold: { ...own, bidderId: conn.bidderId } }
            : {}),
        });
      }
    });
  }

  /** While paused the deadline moves with the clock: now plus what resume will restore. */
  private endTsFor(view: EngineView, now: ReturnType<Clock['now']>): typeof view.endTs {
    return view.paused ? ((now + (view.remainingMs ?? 0)) as typeof view.endTs) : view.endTs;
  }

  /** The one place a `price` frame is built: deadline and pause flags as clients must read them. */
  private priceFrame(view: EngineView, seq: number, ts: ReturnType<Clock['now']>): ServerMsg {
    const leaderPaddle = view.leader ? (this.roster.get(view.leader)?.paddle ?? null) : null;
    return {
      v: 1,
      t: 'price',
      seq,
      ts,
      price: view.price as Cents,
      leaderId: view.leader,
      leaderPaddle,
      endTs: this.endTsFor(view, ts),
      minNext: view.minNext,
      extensions: view.extensions,
      ...(view.paused ? { paused: true, remainingMs: view.remainingMs ?? 0 } : {}),
    } as unknown as ServerMsg;
  }

  private broadcastPrice(seq: number, ts: ReturnType<Clock['now']>): void {
    const view = this.requireEngine().view();
    if (view.price === null) {
      // No price frame can express "no bids" (R-RT-036): send a snapshot so seq stays gapless.
      for (const conn of this.conns.values()) this.sendState(conn);
      return;
    }
    for (const conn of this.conns.values()) this.send(conn, this.priceFrame(view, seq, ts));
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
    this.send(conn, this.priceFrame(view, seq, ts));
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
      ...(this.hammered && this.endedByAuctioneer ? { stopped: true } : {}),
      ...(this.hammered || this.done ? { registrationClosed: true } : {}),
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
    if (conn.bidderId && you) {
      const high = this.highBids.get(conn.bidderId);
      snapshot.you = {
        bidderId: conn.bidderId,
        ceiling: you.ceiling,
        ...(high !== undefined ? { highBid: high } : {}),
      };
    }
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

  private sendError(
    conn: Connection,
    code: ErrorCode,
    retryAfterMs?: number,
    message: string = code,
  ): void {
    const msg: ServerMsg = { v: 1, t: 'error', code, message };
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
    this.highBids = fresh.highBids;
    this.replies = fresh.replies;
    this.audit = fresh.audit;
    this.seq = fresh.seq;
    this.bidCount = fresh.bidCount;
    this.rejectedCount = fresh.rejectedCount;
    this.holdsBy = fresh.holdsBy;
    this.lastState = fresh.lastState;
    this.closingAt = fresh.closingAt;
    this.controlIds = fresh.controlIds;
    this.hammered = fresh.hammered;
    this.endedByAuctioneer = fresh.endedByAuctioneer;
    this.revoked = fresh.revoked;
    this.settleRequested = fresh.settleRequested;
    this.settlement = fresh.settlement;
    this.done = fresh.done;
    this.dirty = false;
    if (moved) this.rebuildConfirms(fresh);
    this.armTimer();
    // Tell everyone about events they never saw: resend the state (R-RT-056).
    if (moved) for (const conn of this.conns.values()) this.sendState(conn);
  }

  /**
   * The log moved past what this room knew, so the held bids are rebuilt from it: a hold the log
   * already resolved goes (its timer is cancelled), a hold the log left open comes back armed.
   * Without this a hold that was accepted could still expire later and tell the bidder a placed
   * bid failed (R-RT-046). Expiry of an overdue hold runs through the queue, never inline.
   */
  private rebuildConfirms(fresh: Room): void {
    this.confirms.clear();
    const now = this.deps.clock.now();
    for (const held of fresh.acceptedWithoutBid.values()) {
      const again: PendingConfirm = { ...held, expiresAt: (now + CONFIRM_TTL_MS) as EpochMs };
      this.confirms.add(again);
      this.armConfirmTimer(again);
    }
    for (const held of fresh.openConfirms.values()) {
      this.confirms.add(held);
      this.armConfirmTimer(held, Math.max(held.expiresAt, now));
    }
  }

  private async replay(): Promise<void> {
    this.config = undefined;
    this.engine = undefined;
    this.roster = new Map();
    this.highBids = new Map();
    this.replies = new Map();
    this.manualCounts = new Map();
    this.audit = [];
    this.seq = 0;
    this.bidCount = 0;
    this.rejectedCount = 0;
    this.holdsBy = new Map();
    this.lastState = 'OPEN';
    this.closingAt = undefined;
    this.controlIds = new Map();
    this.openConfirms = new Map();
    this.acceptedWithoutBid = new Map();
    this.hammered = undefined;
    this.abortPending = false;
    this.endedByAuctioneer = false;
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
        this.controlIds.set(event.controlId, event.action);
        if (event.action === 'hammer') this.endedByAuctioneer = true;
        if (event.action !== 'hammer' && event.action !== 'open') {
          try {
            this.applyClock(this.requireEngine(), event.action, event.ts, event.args?.extraMs);
          } catch {
            // The engine refused what the live room accepted (older build); keep loading.
          }
        }
        // Only the room writes the audit reason, so a client-chosen control id cannot fake it.
        if (
          event.controlId === abortControlId(this.auctionId) &&
          event.audit.reason === ABORT_AUDIT_REASON
        ) {
          this.abortPending = true;
        }
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
        {
          this.rejectedCount += 1;
          this.holdsBy.set(event.bidderId, (this.holdsBy.get(event.bidderId) ?? 0) + 1);
          const by = manualSubject(event.audit);
          if (by !== undefined) this.manualCounts.set(by, (this.manualCounts.get(by) ?? 0) + 1);
          this.openConfirms.set(event.confirmId, {
            confirmId: event.confirmId,
            bidderId: event.bidderId,
            mid: event.mid,
            amount: event.amount,
            ...(by !== undefined
              ? { manualBy: by }
              : {
                  ...(event.audit.transcript !== undefined
                    ? { transcript: event.audit.transcript }
                    : {}),
                  ...(event.audit.confidence !== undefined
                    ? { confidence: event.audit.confidence }
                    : {}),
                }),
            expiresAt: event.expiresAt,
          });
        }
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

  /** Remember a reply for replay; the oldest are dropped past MAX_REPLIES (R12-S05). */
  private keepReply(key: string, entry: { reply: Reply; digest: string }): void {
    this.replies.delete(key);
    this.replies.set(key, entry);
    while (this.replies.size > MAX_REPLIES) {
      const oldest = this.replies.keys().next().value;
      if (oldest === undefined) break;
      this.replies.delete(oldest);
    }
  }

  private noteHighBid(bidderId: BidderId, amount: Cents): void {
    if (amount > (this.highBids.get(bidderId) ?? 0)) this.highBids.set(bidderId, amount);
  }

  private remember(event: Extract<RoomEvent, { type: 'bid_accepted' | 'bid_rejected' }>): void {
    if (event.type === 'bid_accepted') {
      this.bidCount += 1;
      this.noteHighBid(event.bidderId, event.amount);
    } else this.rejectedCount += 1;
    this.acceptedWithoutBid.delete(`${event.bidderId}:${event.mid}`);
    const reply = this.replyFor(event);
    if (reply) {
      const digest = bidDigest(event.audit.parsedAmount, event.audit.source);
      this.keepReply(`${event.bidderId}:${event.mid}`, { reply, digest });
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
