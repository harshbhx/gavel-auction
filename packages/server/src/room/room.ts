import {
  ERROR_TABLE,
  GavelError,
  MAX_BIDDERS_PER_ROOM,
  encodeMsg,
  isCents,
  type AuctionConfig,
  type AuctionId,
  type AuditPayload,
  type BidMsg,
  type BidderId,
  type BidId,
  type CancelTimer,
  type Clock,
  type Cents,
  type ConnId,
  type EnginePort,
  type ErrorCode,
  type Ids,
  type RoomEvent,
  type RoomSnapshot,
  type RoomStore,
  type ServerMsg,
  type Transport,
} from '@gavel/shared';
import { authorize, redactForViewer } from '../auth/authorize';
import type { RateLimiter } from '../limits/rate-limiter';

/** One live connection as the room sees it. Identity comes from the verified token only. */
export interface Connection {
  id: ConnId;
  role: 'auctioneer' | 'bidder' | 'screen';
  /** Set for bidder tokens. */
  bidderId?: BidderId;
  /** Token subject, recorded in the audit trail for manual bids. */
  sub: string;
  transport: Transport;
}

export interface RoomDeps {
  store: RoomStore;
  clock: Clock;
  ids: Ids;
  /** Builds a fresh engine for a config; called again whenever the room is rebuilt from its log. */
  engine: (config: AuctionConfig) => EnginePort;
  limiter?: RateLimiter;
}

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
}

type Reply = Extract<ServerMsg, { t: 'bid_accepted' | 'bid_rejected' }>;

const READ_PAGE = 1000;
const RECENT_AUDIT = 50;

/**
 * A single auction room. Every mutation goes through one FIFO mailbox that runs
 * one command at a time (R-RT-030); seq and server time are taken at dequeue
 * (R-RT-031); events are appended before anything is sent (R-RT-032) and a
 * failed append leaves state unchanged (R-RT-033).
 */
export class Room {
  private tail: Promise<void> = Promise.resolve();
  private inFlight = 0;
  private maxInFlight = 0;
  private seq = 0;
  private config: AuctionConfig | undefined;
  private engine: EnginePort | undefined;
  private lastState = 'OPEN';
  private roster = new Map<BidderId, RosterEntry>();
  private replies = new Map<string, Reply>();
  private audit: AuditPayload[] = [];
  private readonly conns = new Map<ConnId, Connection>();
  private cancelTimer: CancelTimer | undefined;
  /** True when the engine may be ahead of the stored log and must be rebuilt first. */
  private dirty = false;

  private constructor(
    readonly auctionId: AuctionId,
    private readonly deps: RoomDeps,
  ) {}

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
    return room;
  }

  /** Highest number of commands ever running at once; must stay at 1. */
  get maxConcurrent(): number {
    return this.maxInFlight;
  }

  get lastSeq(): number {
    return this.seq;
  }

  get connectionCount(): number {
    return this.conns.size;
  }

  attach(conn: Connection): Promise<void> {
    return this.enqueue(async () => {
      this.conns.set(conn.id, conn);
      this.sendState(conn);
    });
  }

  detach(connId: ConnId): void {
    this.conns.delete(connId);
  }

  async close(): Promise<void> {
    this.cancelTimer?.();
    this.cancelTimer = undefined;
    await this.tail;
  }

  /** Report a payment hold: the bidder joins the roster with their private ceiling (R-RT-054). */
  registerBidder(reg: RegisterBidder): Promise<void> {
    return this.enqueue(async () => {
      if (this.roster.has(reg.bidderId)) return;
      if (this.roster.size >= MAX_BIDDERS_PER_ROOM) throw new GavelError('room_full');
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
        name: reg.name,
        ceiling: reg.ceiling,
        holdRef: reg.holdRef,
      };
      await this.deps.store.appendEvents(this.auctionId, this.seq, [event]);
      this.seq = seq;
      this.applyRegistered(event);
      for (const conn of this.conns.values()) {
        if (conn.role === 'bidder' && conn.bidderId === reg.bidderId) {
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
      }
    });
  }

  /**
   * Submit a bid from a connection. Pipeline order (R-RT-035): rate limit, role
   * check, schema (already decoded), registered, engine validation.
   */
  submitBid(conn: Connection, msg: BidMsg): Promise<void> {
    const limited = this.deps.limiter?.checkBid(conn.bidderId ?? conn.id);
    if (limited && !limited.ok) {
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
    return this.enqueue(() => this.handleBid(conn, msg, bidderId));
  }

  private async handleBid(conn: Connection, msg: BidMsg, bidderId: BidderId): Promise<void> {
    const key = `${bidderId}:${msg.mid}`;
    const prior = this.replies.get(key);
    if (prior) {
      // A replay returns the original reply and appends nothing (R-RT-034).
      this.send(conn, prior);
      return;
    }
    try {
      await this.ensureClean();
    } catch {
      this.sendError(conn, 'store_unavailable');
      return;
    }
    const engine = this.requireEngine();
    const ts = this.deps.clock.now();
    const seq = this.seq + 1;

    let code: ErrorCode | undefined;
    if (!isCents(msg.amount)) code = 'bad_amount';
    else if (!this.roster.has(bidderId)) code = 'unregistered';
    else {
      const res = engine.placeBid(bidderId, msg.amount, ts);
      if (!res.ok) code = res.code;
    }

    const bidId = this.deps.ids.mint<'BidId'>();
    const audit = this.buildAudit(bidId, bidderId, msg, conn, code, ts, seq);
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
            source: msg.source,
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
      await this.deps.store.appendEvents(this.auctionId, this.seq, [event]);
    } catch {
      // State must not change: rebuild the engine from the log and tell the sender.
      await this.recover().catch(() => undefined);
      this.sendError(conn, 'store_unavailable');
      return;
    }
    this.seq = seq;
    this.pushAudit(audit);
    const reply = this.replyFor(event);
    if (reply) this.replies.set(key, reply);
    if (reply) this.send(conn, reply);
    if (event.type === 'bid_accepted') {
      this.broadcastPrice(seq, ts);
      this.armTimer();
    }
    this.broadcastAudit(audit, seq, ts);
  }

  private buildAudit(
    bidId: BidId,
    bidderId: BidderId,
    msg: BidMsg,
    conn: Connection,
    code: ErrorCode | undefined,
    ts: ReturnType<Clock['now']>,
    seq: number,
  ): AuditPayload {
    const audit: AuditPayload = {
      bidId,
      bidderId,
      source: conn.role === 'auctioneer' ? 'manual' : msg.source,
      outcome: code === undefined ? 'accepted' : 'rejected',
      serverTs: ts,
      seq,
    };
    if (isCents(msg.amount)) audit.parsedAmount = msg.amount;
    if (msg.transcript !== undefined) audit.transcript = msg.transcript;
    if (msg.confidence !== undefined) audit.confidence = msg.confidence;
    if (code !== undefined) audit.reason = code;
    if (conn.role === 'auctioneer') audit.transcript = `manual by ${conn.sub}`.slice(0, 120);
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

  private broadcastPrice(seq: number, ts: ReturnType<Clock['now']>): void {
    const view = this.requireEngine().view();
    if (view.price === null) return;
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
        endTs: view.endTs,
        minNext: view.minNext,
        extensions: view.extensions,
      });
    }
  }

  private broadcastAudit(audit: AuditPayload, seq: number, ts: ReturnType<Clock['now']>): void {
    for (const conn of this.conns.values()) {
      this.send(conn, { v: 1, t: 'audit_event', seq, ts, audit });
    }
  }

  private snapshotFor(conn: Connection): RoomSnapshot {
    const config = this.config;
    if (!config) throw new GavelError('internal', 'room has no config');
    const view = this.requireEngine().view();
    const you = conn.bidderId ? this.roster.get(conn.bidderId) : undefined;
    const snapshot: RoomSnapshot = {
      auctionId: this.auctionId,
      config,
      status: view.state,
      price: view.price,
      leaderId: view.leader,
      endTs: view.endTs,
      minNext: view.minNext,
      roster: [...this.roster].map(([bidderId, r]) => ({
        bidderId,
        paddle: r.paddle,
        name: r.name,
        hold: 'HELD' as const,
      })),
      recentAudit: [...this.audit],
    };
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
    if (enc.ok) conn.transport.send(enc.value);
  }

  private sendError(conn: Connection, code: ErrorCode, retryAfterMs?: number): void {
    const msg: ServerMsg = { v: 1, t: 'error', code, message: code };
    if (retryAfterMs !== undefined) msg.retryAfterMs = retryAfterMs;
    this.send(conn, msg);
  }

  /** Re-arm the close timer for the engine's current endTs (R-RT-041). */
  private armTimer(): void {
    this.cancelTimer?.();
    const view = this.engine?.view();
    if (!view || view.state !== 'OPEN') return;
    this.cancelTimer = this.deps.clock.setTimer(view.endTs, () => {
      void this.enqueue(() => this.onTimer());
    });
  }

  private async onTimer(): Promise<void> {
    try {
      await this.ensureClean();
    } catch {
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
    if (to === from) return;
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
      await this.deps.store.appendEvents(this.auctionId, this.seq, [event]);
    } catch {
      await this.recover().catch(() => undefined);
      return;
    }
    this.seq = seq;
    this.lastState = to;
    for (const conn of this.conns.values()) this.sendState(conn);
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
    if (!this.dirty) return;
    const fresh = new Room(this.auctionId, this.deps);
    try {
      await fresh.replay();
    } catch {
      throw new GavelError('store_unavailable');
    }
    this.config = fresh.config;
    this.engine = fresh.engine;
    this.roster = fresh.roster;
    this.replies = fresh.replies;
    this.audit = fresh.audit;
    this.seq = fresh.seq;
    this.lastState = fresh.lastState;
    this.dirty = false;
    this.armTimer();
  }

  private async replay(): Promise<void> {
    this.config = undefined;
    this.engine = undefined;
    this.roster = new Map();
    this.replies = new Map();
    this.audit = [];
    this.seq = 0;
    this.lastState = 'OPEN';
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
        this.engine = this.deps.engine(event.config);
        break;
      case 'bidder_registered':
        this.applyRegistered(event);
        break;
      case 'bid_accepted':
        this.requireEngine().placeBid(event.bidderId, event.amount, event.ts);
        this.remember(event);
        break;
      case 'bid_rejected':
        this.remember(event);
        break;
      case 'state_changed':
        this.requireEngine().tick(event.ts);
        this.lastState = event.to;
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
    });
  }

  private remember(event: Extract<RoomEvent, { type: 'bid_accepted' | 'bid_rejected' }>): void {
    const reply = this.replyFor(event);
    if (reply) this.replies.set(`${event.bidderId}:${event.mid}`, reply);
    this.pushAudit(event.audit);
  }

  private pushAudit(audit: AuditPayload): void {
    this.audit.push(audit);
    if (this.audit.length > RECENT_AUDIT) this.audit.shift();
  }

  private requireEngine(): EnginePort {
    if (!this.engine) throw new GavelError('internal', 'room is not loaded');
    return this.engine;
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(async () => {
      this.inFlight += 1;
      this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
      try {
        return await fn();
      } finally {
        this.inFlight -= 1;
      }
    });
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
