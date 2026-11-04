import { DEFAULT_AUCTION_CONFIG } from './config.js';
import type { Candidate, SettlementState, UnsoldReason } from './events.js';
import { bestByBidder, rank } from './rules/ranking.js';
import type { BidRecord } from './rules/ranking.js';
import type { AuctionConfig, LotConfig, LotStatus, Ulid } from './types.js';

/** Zero hash used as `prev` of the first ledger entry. */
export const GENESIS_HASH = '0'.repeat(64);

export interface BidderState {
  readonly bidderId: Ulid;
  /** Lot the ceiling is scoped to; null when holdScope is `event`. */
  readonly lotId: Ulid | null;
  readonly ceilingCents: number;
  /** Opaque audit reference, never interpreted (R-ENG-046). */
  readonly holdRef: string | null;
  readonly revoked: boolean;
}

export interface SkippedCandidate {
  readonly bidderId: Ulid;
  readonly reason: string;
  readonly depth: number;
  readonly priceCents: number;
}

export interface LotState {
  readonly lotId: Ulid;
  readonly config: LotConfig | null;
  readonly status: LotStatus;
  readonly openedAt: number | null;
  readonly endsAt: number | null;
  readonly extensions: number;
  /** Every recorded bid in arrival order, struck bids included. */
  readonly bids: readonly BidRecord[];
  /** Derived index: each bidder's best active bid. */
  readonly best: Readonly<Record<string, BidRecord>>;
  /** Derived: bidder with the top active bid, or null. */
  readonly leaderId: Ulid | null;
  readonly winnerId: Ulid | null;
  readonly priceCents: number | null;
  readonly candidates: readonly Candidate[];
  readonly depth: number;
  /** Bidders removed from the winner position by fallback, oldest first. */
  readonly demoted: readonly Ulid[];
  readonly skipped: readonly SkippedCandidate[];
  readonly settlement: SettlementState;
  readonly capturedCents: number | null;
  readonly unsoldReason: UnsoldReason | null;
  readonly closedAtSeq: number | null;
}

export interface AuctionHead {
  readonly seq: number;
  readonly at: number;
  readonly hash: string;
}

export interface AuctionState {
  readonly auctionId: Ulid | null;
  readonly title: string | null;
  readonly config: AuctionConfig;
  readonly lotOrder: readonly Ulid[];
  readonly lots: Readonly<Record<string, LotState>>;
  /** Keyed by `bidderKey`. */
  readonly bidders: Readonly<Record<string, BidderState>>;
  /** commandId to the seq of the first entry it produced. */
  readonly commands: Readonly<Record<string, number>>;
  readonly head: AuctionHead;
  readonly closed: boolean;
  readonly closedHeadHash: string | null;
}

export const initialState: AuctionState = {
  auctionId: null,
  title: null,
  config: DEFAULT_AUCTION_CONFIG,
  lotOrder: [],
  lots: {},
  bidders: {},
  commands: {},
  head: { seq: 0, at: 0, hash: GENESIS_HASH },
  closed: false,
  closedHeadHash: null,
};

/** Key of a bidder record: the bidder id, plus the lot when the ceiling is per lot. */
export function bidderKey(bidderId: string, lotId?: string | null): string {
  return lotId === undefined || lotId === null ? bidderId : `${bidderId}@${lotId}`;
}

export function newLot(lotId: Ulid, config: LotConfig | null): LotState {
  return {
    lotId,
    config,
    status: 'PENDING',
    openedAt: null,
    endsAt: null,
    extensions: 0,
    bids: [],
    best: {},
    leaderId: null,
    winnerId: null,
    priceCents: null,
    candidates: [],
    depth: 0,
    demoted: [],
    skipped: [],
    settlement: 'HELD',
    capturedCents: null,
    unsoldReason: null,
    closedAtSeq: null,
  };
}

/** Recomputes the derived indexes after the bid list changed. */
export function withBids(lot: LotState, bids: readonly BidRecord[]): LotState {
  const best = Object.fromEntries(bestByBidder(bids));
  const top = rank(bids)[0];
  return { ...lot, bids, best, leaderId: top === undefined ? null : (top.bidderId as Ulid) };
}
