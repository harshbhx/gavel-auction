import type {
  AuctionId,
  BidSource,
  BidderId,
  Cents,
  ControlAction,
  EngineBidResult,
  EnginePort,
  EpochMs,
  OwnHold,
  SettlementState,
} from '@gavel/shared';

/** Outcome of closing the auction: who won, at what price, and everyone ranked by their top bid. */
export interface HammerResult {
  winnerId: BidderId | null;
  price: Cents;
  ranking: Array<{ bidderId: BidderId; amount: Cents }>;
}

/**
 * An engine that can also close the auction. The engine runtime adapter in the
 * host implements this on top of its Hammer command; the room only sees the port.
 * `hammer` is valid from CLOSING, or from OPEN when the auctioneer closes early.
 */
export interface HammerEnginePort extends EnginePort {
  hammer(now: EpochMs): HammerResult;
}

/** An engine that can cancel the lot before the hammer (kill switch). The result is an unsold hammer. */
export interface AbortEnginePort extends HammerEnginePort {
  abort(now: EpochMs): HammerResult;
}

/** An engine whose lot clock the auctioneer can pause, resume and extend (R-RT-049). */
export interface ClockEnginePort extends EnginePort {
  readonly paused: boolean;
  pause(now: EpochMs): void;
  resume(now: EpochMs): void;
  extend(now: EpochMs, extraMs: number): void;
}

export function canClock(engine: EnginePort): engine is ClockEnginePort {
  return typeof (engine as Partial<ClockEnginePort>).pause === 'function';
}

/** What the room knows about a bid beyond its amount; the engine ledger keeps it. */
export interface BidMeta {
  source: BidSource;
  transcript?: string;
  /** Parser confidence, 0 to 1. */
  confidence?: number;
  /** True once the bidder answered a confirm request for this bid (R-RT-046). */
  confirmed?: boolean;
  /** Start and end of the spoken bid in the audio stream; voice bids only. */
  audioStartMs?: number;
  audioEndMs?: number;
  /** The amount the parser heard, in cents; voice bids only. */
  parsedCents?: Cents;
}

/** An engine that records the source and the audit fields of every bid. */
export interface MetaBidEnginePort extends EnginePort {
  placeBidWith(bidder: BidderId, amount: Cents, ts: EpochMs, meta: BidMeta): EngineBidResult;
}

export function canPlaceWithMeta(engine: EnginePort): engine is MetaBidEnginePort {
  return typeof (engine as Partial<MetaBidEnginePort>).placeBidWith === 'function';
}

export function canAbort(engine: EnginePort): engine is AbortEnginePort {
  return typeof (engine as Partial<AbortEnginePort>).abort === 'function';
}

export type RevokeReason = 'declined' | 'expired' | 'voided';

/** An engine that can revoke a bidder's ceiling while the lot is open. */
export interface RevokeEnginePort extends EnginePort {
  /** Returns false when the bidder was already revoked. */
  revoke(bidder: BidderId, reason: RevokeReason, now: EpochMs): boolean;
}

export function canRevoke(engine: EnginePort): engine is RevokeEnginePort {
  return typeof (engine as Partial<RevokeEnginePort>).revoke === 'function';
}

/**
 * Called after the room log holds an event and before the room acknowledges it. The host
 * writes the engine ledger here; a throw means the write is not durable yet, so the
 * sender gets no acknowledgement and may retry.
 */
export type DurableHook = (auctionId: AuctionId, engine: EnginePort) => Promise<void>;

export function canHammer(engine: EnginePort): engine is HammerEnginePort {
  return typeof (engine as Partial<HammerEnginePort>).hammer === 'function';
}

/** The room's side of payments: called at most once per process for a hammered auction. */
export interface SettlePort {
  /** Must be idempotent by `auctionId`; progress comes back through `Room.reportSettlement`. */
  settle(auctionId: AuctionId, outcome: HammerResult): Promise<void>;
}

/** One settlement progress report from payments. `rev` orders reports; stale ones are dropped. */
export interface SettlementReport {
  rev: number;
  auctionState: SettlementState;
  perBidder: Record<string, SettlementState>;
  amountCaptured?: Cents | undefined;
  note?: string | undefined;
  /**
   * Each bidder's own hold, keyed by bidder id. The room sends an entry only to the bidder it
   * belongs to (`yourHold`) and never stores it in the log.
   */
  holds?: Readonly<Record<string, Omit<OwnHold, 'bidderId'>>> | undefined;
  /** The bidder whose hold was captured, once there is one; the room sends only their paddle. */
  winnerId?: string | undefined;
}

/** An auctioneer control command (R-RT-048); the host maps its HTTP route onto this. */
export interface ControlCommand {
  controlId: string;
  action: ControlAction;
  args?: Record<string, number>;
}

/** Auction-level settlement states after which the room is DONE (R-RT-053). */
export const TERMINAL_SETTLEMENT: readonly SettlementState[] = ['SETTLED', 'FAILED_NEEDS_REVIEW'];
