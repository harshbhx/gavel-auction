import { canonicalize } from './canonical.js';
import type { JsonValue } from './canonical.js';
import type { Command } from './commands.js';
import { DEFAULT_AUCTION_CONFIG } from './config.js';
import type { BidAudit, LedgerEntry } from './events.js';
import { pureHasher } from './sha256.js';
import { utf8 } from './hasher.js';
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

/** A command that produced at least one entry. `body` is null until an entry echoes it. */
export interface SeenCommand {
  readonly seq: number;
  readonly body: string | null;
}

export interface AuctionState {
  readonly auctionId: Ulid | null;
  readonly title: string | null;
  readonly config: AuctionConfig;
  readonly lotOrder: readonly Ulid[];
  readonly lots: Readonly<Record<string, LotState>>;
  /** Keyed by `bidderKey`. */
  readonly bidders: Readonly<Record<string, BidderState>>;
  /** Seen-command index: commandId to its first seq and body digest (R-ENG-087, R-ENG-088). */
  readonly commands: Readonly<Record<string, SeenCommand>>;
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

const digestOf = (v: JsonValue): string => pureHasher.sha256Hex(utf8(canonicalize(v)));

/** Bid amount as echoed in a ledger entry: the integer, else the raw text (R-ENG-082). */
function amountKey(amountCents: unknown): JsonValue {
  return typeof amountCents === 'number' && Number.isSafeInteger(amountCents)
    ? amountCents
    : String(amountCents).slice(0, 40);
}

const withOptional = (base: Record<string, JsonValue>, k: string, v: unknown): void => {
  if (v !== undefined && v !== null) base[k] = v as JsonValue;
};

/**
 * Digest of the parts of a command that its entries echo, `at` excluded so a
 * retry with a later timestamp is still the same command (R-ENG-087). Null for
 * command types whose entries do not echo a body. Must agree with `entryBody`.
 */
export function commandBody(cmd: Command): string | null {
  switch (cmd.type) {
    case 'CreateAuction':
      return digestOf({
        t: 'CreateAuction',
        title: cmd.title,
        config: { ...cmd.config } as unknown as JsonValue,
      });
    case 'AddLot':
      return digestOf({ t: 'AddLot', lotId: cmd.lot.lotId });
    case 'RegisterBidder': {
      const b: Record<string, JsonValue> = {
        t: 'RegisterBidder',
        bidderId: cmd.bidderId,
        ceilingCents: cmd.ceilingCents,
      };
      withOptional(b, 'lotId', cmd.lotId);
      return digestOf(b);
    }
    case 'OpenLot':
      return digestOf({ t: 'OpenLot', lotId: cmd.lotId });
    case 'PlaceBid':
      return digestOf({
        t: 'PlaceBid',
        lotId: cmd.lotId,
        bidderId: cmd.bidderId,
        amount: amountKey(cmd.amountCents),
        source: cmd.source,
        audit: { ...cmd.audit } as unknown as JsonValue,
      });
    case 'Hammer':
      return digestOf({ t: 'Hammer', lotId: cmd.lotId });
    default:
      return null;
  }
}

function bidBody(
  p: { lotId: string; bidderId: string; source: string; audit: BidAudit },
  amount: unknown,
): string {
  return digestOf({
    t: 'PlaceBid',
    lotId: p.lotId,
    bidderId: p.bidderId,
    amount: amountKey(amount),
    source: p.source,
    audit: { ...p.audit } as unknown as JsonValue,
  });
}

/** Body digest recoverable from one ledger entry, or null when it echoes none. */
export function entryBody(e: LedgerEntry): string | null {
  switch (e.type) {
    case 'AUCTION_CREATED':
      return digestOf({
        t: 'CreateAuction',
        title: e.payload.title,
        config: { ...e.payload.config } as unknown as JsonValue,
      });
    case 'LOT_ADDED':
      return digestOf({ t: 'AddLot', lotId: e.payload.lotId });
    case 'BIDDER_REGISTERED':
    case 'CEILING_RAISED': {
      const p = e.payload;
      const b: Record<string, JsonValue> = {
        t: 'RegisterBidder',
        bidderId: p.bidderId,
        ceilingCents: p.ceilingCents,
      };
      withOptional(b, 'lotId', p.lotId);
      return digestOf(b);
    }
    case 'LOT_OPENED':
      return digestOf({ t: 'OpenLot', lotId: e.payload.lotId });
    case 'BID_RECORDED':
      return bidBody(e.payload, e.payload.amountCents);
    case 'BID_REJECTED':
      return bidBody(e.payload, e.payload.amountCents ?? e.payload.amountRaw ?? null);
    case 'LOT_HAMMERED':
    case 'LOT_UNSOLD':
      return digestOf({ t: 'Hammer', lotId: e.payload.lotId });
    default:
      return null;
  }
}

/** Adds an entry to the seen-command index; later entries of a command may fill its body. */
export function recordCommand(
  commands: AuctionState['commands'],
  e: LedgerEntry,
): AuctionState['commands'] {
  if (e.cmd === null) return commands;
  const seen = commands[e.cmd];
  if (seen !== undefined && seen.body !== null) return commands;
  const body = entryBody(e);
  if (seen === undefined) return { ...commands, [e.cmd]: { seq: e.seq, body } };
  return body === null ? commands : { ...commands, [e.cmd]: { seq: seen.seq, body } };
}
