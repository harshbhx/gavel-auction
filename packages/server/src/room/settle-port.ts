import type {
  AuctionId,
  BidderId,
  Cents,
  ControlAction,
  EnginePort,
  EpochMs,
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
}

/** An auctioneer control command (R-RT-048); the host maps its HTTP route onto this. */
export interface ControlCommand {
  controlId: string;
  action: ControlAction;
  args?: Record<string, number>;
}

/** Auction-level settlement states after which the room is DONE (R-RT-053). */
export const TERMINAL_SETTLEMENT: readonly SettlementState[] = ['SETTLED', 'FAILED_NEEDS_REVIEW'];
