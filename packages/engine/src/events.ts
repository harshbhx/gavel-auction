import type { RejectReason } from './reasons.js';
import type { AuctionConfig, BidSource, LotConfig, Mode, Ulid } from './types.js';

/** Fixed settlement states (R-ENG-067). The transition graph is owned by payments. */
export const SETTLEMENT_STATES = [
  'HELD',
  'BIDDING',
  'WINNER_SELECTED',
  'CAPTURING',
  'CAPTURED',
  'VOIDING',
  'SETTLED',
  'FALLBACK_RUNNER_UP',
  'FAILED_NEEDS_REVIEW',
] as const;
export type SettlementState = (typeof SETTLEMENT_STATES)[number];

/**
 * The edges the settlement saga may record (SPEC 6.1), the same set as the payments
 * state machine. RecordSettlement refuses any other pair (R-ENG-067).
 */
export const SETTLEMENT_EDGES: readonly (readonly [SettlementState, SettlementState])[] = [
  ['HELD', 'BIDDING'],
  ['HELD', 'VOIDING'],
  ['BIDDING', 'VOIDING'],
  ['BIDDING', 'WINNER_SELECTED'],
  ['WINNER_SELECTED', 'VOIDING'],
  ['WINNER_SELECTED', 'CAPTURING'],
  ['CAPTURING', 'CAPTURED'],
  ['CAPTURING', 'FALLBACK_RUNNER_UP'],
  ['FALLBACK_RUNNER_UP', 'CAPTURING'],
  ['FALLBACK_RUNNER_UP', 'VOIDING'],
  ['CAPTURED', 'VOIDING'],
  ['VOIDING', 'SETTLED'],
  ['WINNER_SELECTED', 'FAILED_NEEDS_REVIEW'],
  ['CAPTURING', 'FAILED_NEEDS_REVIEW'],
  ['FALLBACK_RUNNER_UP', 'FAILED_NEEDS_REVIEW'],
  ['CAPTURED', 'FAILED_NEEDS_REVIEW'],
  ['VOIDING', 'FAILED_NEEDS_REVIEW'],
];

/** Bid audit record (R-ENG-083). */
export interface BidAudit {
  utteranceId?: string;
  audioStartMs?: number;
  audioEndMs?: number;
  transcript?: string;
  confidenceBps?: number;
  confirmed?: boolean;
  parserVersion?: string;
  clientTs?: number;
}

export interface RankedEntry {
  bidderId: Ulid;
  amountCents: number;
  at: number;
  seq: number;
}

export interface Candidate {
  bidderId: Ulid;
  priceCents: number;
}

export type CloseReason = 'deadline' | 'early';
export type UnsoldReason = 'no_bids' | 'no_valid_winner';
export type RevokeReason = 'declined' | 'expired' | 'voided' | 'other';

/** The 22 ledger event types and their payloads (spec section 4.5). */
export type LedgerEvent =
  | {
      type: 'AUCTION_CREATED';
      payload: { title: string; config: Partial<AuctionConfig> };
    }
  | { type: 'LOT_ADDED'; payload: { lotId: Ulid; lot?: LotConfig } }
  | {
      type: 'BIDDER_REGISTERED';
      payload: { bidderId: Ulid; ceilingCents: number; holdRef?: string; lotId?: Ulid };
    }
  | {
      type: 'CEILING_RAISED';
      payload: {
        bidderId: Ulid;
        fromCents: number;
        ceilingCents: number;
        holdRef?: string;
        lotId?: Ulid;
      };
    }
  | {
      type: 'CEILING_REVOKED';
      /** `lotId` is set when only that lot's record is revoked (holdScope lot, R12-E09). */
      payload: { bidderId: Ulid; reason: RevokeReason; holdRef?: string; lotId?: Ulid };
    }
  | { type: 'LOT_OPENED'; payload: { lotId: Ulid; endsAt: number } }
  | {
      type: 'BID_RECORDED';
      payload: {
        bidId: string;
        lotId: Ulid;
        bidderId: Ulid;
        amountCents: number;
        source: BidSource;
        audit: BidAudit;
        priceBefore: number | null;
        priceAfter: number | null;
        leaderBefore: Ulid | null;
        leaderAfter: Ulid | null;
        rank: number | null;
        endsAtBefore: number;
        endsAtAfter: number;
      };
    }
  | {
      type: 'BID_REJECTED';
      payload: {
        bidId: string;
        lotId: Ulid;
        bidderId: Ulid;
        amountCents: number | null;
        amountRaw?: string;
        source: BidSource;
        audit: BidAudit;
        reason: RejectReason;
        detail: Record<string, string | number | boolean | null>;
      };
    }
  | { type: 'BID_STRUCK'; payload: { bidId: string; lotId: Ulid; bidderId: Ulid; reason: string } }
  | {
      type: 'END_EXTENDED';
      payload: {
        lotId: Ulid;
        endsAtBefore: number;
        endsAtAfter: number;
        extensions: number;
        triggerBidId: string;
      };
    }
  | { type: 'LOT_CLOSING'; payload: { lotId: Ulid; reason: CloseReason } }
  | {
      type: 'LOT_HAMMERED';
      payload: {
        lotId: Ulid;
        winnerId: Ulid;
        priceCents: number;
        mode: Mode;
        ranking: RankedEntry[];
        candidates: Candidate[];
        endsAt: number;
        extensions: number;
        closedAtSeq: number;
        actor?: string;
      };
    }
  | {
      type: 'FALLBACK_PROMOTED';
      payload: {
        lotId: Ulid;
        from: Ulid;
        to: Ulid;
        priceCents: number;
        depth: number;
        reason: string;
      };
    }
  | {
      type: 'CANDIDATE_SKIPPED';
      payload: { lotId: Ulid; bidderId: Ulid; reason: string; depth: number; priceCents: number };
    }
  | {
      type: 'LOT_UNSOLD';
      payload: {
        lotId: Ulid;
        reason: UnsoldReason;
        actor?: string;
        /** The PromoteRunnerUp body that ended the lot, echoed for idempotency (R-ENG-087). */
        disqualifiedBidderId?: Ulid;
        promoteReason?: string;
      };
    }
  | { type: 'LOT_ABORTED'; payload: { lotId: Ulid; reason: string; actor: string } }
  | {
      type: 'LOT_PAUSED';
      payload: { lotId: Ulid; actor: string; remainingMs: number };
    }
  | {
      type: 'LOT_RESUMED';
      payload: { lotId: Ulid; actor: string; endsAtBefore: number; endsAtAfter: number };
    }
  | {
      type: 'LOT_EXTENDED';
      payload: {
        lotId: Ulid;
        actor: string;
        reason: string;
        extraMs: number;
        endsAtBefore: number;
        endsAtAfter: number;
      };
    }
  | {
      type: 'SETTLEMENT_STATE';
      payload: { lotId: Ulid; from: SettlementState; to: SettlementState; ref: string };
    }
  | {
      type: 'LOT_SETTLED';
      payload: { lotId: Ulid; winnerId: Ulid; capturedCents: number; ref: string };
    }
  | { type: 'AUCTION_CLOSED'; payload: { headHash: string } };

export type LedgerEventType = LedgerEvent['type'];

export const LEDGER_EVENT_TYPES = [
  'AUCTION_CREATED',
  'LOT_ADDED',
  'BIDDER_REGISTERED',
  'CEILING_RAISED',
  'CEILING_REVOKED',
  'LOT_OPENED',
  'BID_RECORDED',
  'BID_REJECTED',
  'BID_STRUCK',
  'END_EXTENDED',
  'LOT_CLOSING',
  'LOT_HAMMERED',
  'FALLBACK_PROMOTED',
  'CANDIDATE_SKIPPED',
  'LOT_UNSOLD',
  'LOT_ABORTED',
  'LOT_PAUSED',
  'LOT_RESUMED',
  'LOT_EXTENDED',
  'SETTLEMENT_STATE',
  'LOT_SETTLED',
  'AUCTION_CLOSED',
] as const satisfies readonly LedgerEventType[];

/** A sealed ledger entry (R-ENG-070); `cmd` is the commandId or null. */
export type LedgerEntry = {
  [E in LedgerEvent as E['type']]: {
    v: 1;
    auctionId: Ulid;
    seq: number;
    at: number;
    type: E['type'];
    cmd: Ulid | null;
    payload: E['payload'];
    prev: string;
    hash: string;
  };
}[LedgerEvent['type']];
