import { canonicalize } from './canonical.js';
import type { JsonValue } from './canonical.js';
import type { Command } from './commands.js';
import { DEFAULT_AUCTION_CONFIG, validateLotConfig } from './config.js';
import type { BidAudit, LedgerEntry } from './events.js';
import { pureHasher } from './sha256.js';
import { utf8 } from './hasher.js';
import type { Candidate, SettlementState, UnsoldReason } from './events.js';
import { bestByBidder, better, rank } from './rules/ranking.js';
import type { BidRecord } from './rules/ranking.js';
import type { RejectReason } from './reasons.js';
import { MAX_AMOUNT_CENTS } from './types.js';
import type { AuctionConfig, LotConfig, LotStatus, Ulid } from './types.js';

/**
 * A record with no prototype, so keys such as `constructor` or `__proto__` are plain
 * own keys and never reach Object.prototype (R-ENG-006).
 */
export function dict<T>(entries: Readonly<Record<string, T>> = {}): Record<string, T> {
  return Object.assign(Object.create(null) as Record<string, T>, entries);
}

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
  /** True once the settlement record passed through CAPTURED (a void-only path never sets it). */
  readonly captureSeen: boolean;
  readonly unsoldReason: UnsoldReason | null;
  /** Why the lot was cancelled before the hammer; null for every other lot. */
  readonly abortReason: string | null;
  /** BID_REJECTED entries recorded for this lot (bounds ledger growth from bad bids). */
  readonly rejectedBids: number;
  readonly closedAtSeq: number | null;
}

export interface AuctionHead {
  readonly seq: number;
  readonly at: number;
  readonly hash: string;
}

/** What a seen command originally did, so a retry can be answered the same way (R-ENG-087). */
export type SeenResult = { kind: 'accepted' } | { kind: 'rejected'; reason: RejectReason };

/**
 * A command that produced at least one entry. `body` is null until an entry echoes it;
 * `type` is the command type implied by its entries, null while still unknown.
 */
export interface SeenCommand {
  readonly seq: number;
  readonly body: string | null;
  readonly type: string | null;
  readonly rejected: RejectReason | null;
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
  lots: dict(),
  bidders: dict(),
  commands: dict(),
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
    captureSeen: false,
    unsoldReason: null,
    abortReason: null,
    rejectedBids: 0,
    closedAtSeq: null,
  };
}

/** Recomputes the derived indexes after the bid list changed. */
export function withBids(lot: LotState, bids: readonly BidRecord[]): LotState {
  const best = Object.fromEntries(bestByBidder(bids));
  const top = rank(bids)[0];
  return { ...lot, bids, best, leaderId: top === undefined ? null : (top.bidderId as Ulid) };
}

/**
 * Appends one active bid and updates the derived indexes without re-ranking the
 * whole list: a new bid can only improve its bidder's best and possibly take the lead.
 */
export function withNewBid(lot: LotState, bid: BidRecord): LotState {
  const bids = [...lot.bids, bid];
  const cur = lot.best[bid.bidderId];
  if (cur !== undefined && !better(bid, cur)) return { ...lot, bids };
  const best = { ...lot.best, [bid.bidderId]: bid };
  const lead = lot.leaderId === null ? undefined : best[lot.leaderId];
  const leaderId = lead === undefined || better(bid, lead) ? (bid.bidderId as Ulid) : lot.leaderId;
  return { ...lot, bids, best, leaderId };
}

const digestOf = (v: JsonValue): string => pureHasher.sha256Hex(utf8(canonicalize(v)));

/** Bid amount as echoed in a ledger entry: the integer, else the raw text (R-ENG-082). */
function amountKey(amountCents: unknown): JsonValue {
  return typeof amountCents === 'number' &&
    Number.isSafeInteger(amountCents) &&
    amountCents >= 1 &&
    amountCents <= MAX_AMOUNT_CENTS
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
    case 'AddLot': {
      const v = validateLotConfig(cmd.lot);
      const lot = v.ok ? v.value : cmd.lot;
      return digestOf({ t: 'AddLot', lotId: cmd.lot.lotId, lot: lot as unknown as JsonValue });
    }
    case 'RegisterBidder': {
      const b: Record<string, JsonValue> = {
        t: 'RegisterBidder',
        bidderId: cmd.bidderId,
        ceilingCents: cmd.ceilingCents,
      };
      withOptional(b, 'lotId', cmd.lotId);
      withOptional(b, 'holdRef', cmd.holdRef);
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
      return digestOf({ t: 'Hammer', lotId: cmd.lotId, actor: cmd.actor });
    case 'CompleteLot':
      return digestOf({
        t: 'CompleteLot',
        lotId: cmd.lotId,
        winnerId: cmd.bidderId,
        capturedCents: cmd.capturedCents,
        ref: cmd.ref,
      });
    case 'AbortLot':
      return digestOf({
        t: 'AbortLot',
        lotId: cmd.lotId,
        reason: cmd.reason,
        actor: cmd.actor,
      });
    case 'RecordSettlement':
      return digestOf({
        t: 'RecordSettlement',
        lotId: cmd.lotId,
        from: cmd.from,
        to: cmd.to,
        ref: cmd.ref,
      });
    case 'RevokeCeiling':
      return digestOf({
        t: 'RevokeCeiling',
        bidderId: cmd.bidderId,
        reason: cmd.reason,
        ...(cmd.holdRef === undefined ? {} : { holdRef: cmd.holdRef }),
      });
    case 'PromoteRunnerUp':
      return digestOf({
        t: 'PromoteRunnerUp',
        lotId: cmd.lotId,
        disqualifiedBidderId: cmd.disqualifiedBidderId,
        reason: cmd.reason,
      });
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
      return digestOf({
        t: 'AddLot',
        lotId: e.payload.lotId,
        lot: (e.payload.lot ?? null) as unknown as JsonValue,
      });
    case 'BIDDER_REGISTERED':
    case 'CEILING_RAISED': {
      const p = e.payload;
      const b: Record<string, JsonValue> = {
        t: 'RegisterBidder',
        bidderId: p.bidderId,
        ceilingCents: p.ceilingCents,
      };
      withOptional(b, 'lotId', p.lotId);
      withOptional(b, 'holdRef', p.holdRef);
      return digestOf(b);
    }
    case 'LOT_OPENED':
      return digestOf({ t: 'OpenLot', lotId: e.payload.lotId });
    case 'BID_RECORDED':
      return bidBody(e.payload, e.payload.amountCents);
    case 'BID_REJECTED':
      return bidBody(e.payload, e.payload.amountCents ?? e.payload.amountRaw ?? null);
    case 'LOT_HAMMERED':
      return digestOf({ t: 'Hammer', lotId: e.payload.lotId, actor: e.payload.actor ?? null });
    case 'LOT_UNSOLD':
      // A promotion that ends unsold echoes its body when the payload carries it; older
      // ledgers do not, and echo none.
      if (e.payload.reason === 'no_valid_winner') {
        return e.payload.disqualifiedBidderId === undefined
          ? null
          : digestOf({
              t: 'PromoteRunnerUp',
              lotId: e.payload.lotId,
              disqualifiedBidderId: e.payload.disqualifiedBidderId,
              reason: e.payload.promoteReason ?? '',
            });
      }
      return digestOf({ t: 'Hammer', lotId: e.payload.lotId, actor: e.payload.actor ?? null });
    case 'LOT_SETTLED':
      return digestOf({
        t: 'CompleteLot',
        lotId: e.payload.lotId,
        winnerId: e.payload.winnerId,
        capturedCents: e.payload.capturedCents,
        ref: e.payload.ref,
      });
    case 'LOT_ABORTED':
      return digestOf({
        t: 'AbortLot',
        lotId: e.payload.lotId,
        reason: e.payload.reason,
        actor: e.payload.actor,
      });
    case 'SETTLEMENT_STATE':
      return digestOf({
        t: 'RecordSettlement',
        lotId: e.payload.lotId,
        from: e.payload.from,
        to: e.payload.to,
        ref: e.payload.ref,
      });
    case 'CEILING_REVOKED':
      return digestOf({
        t: 'RevokeCeiling',
        bidderId: e.payload.bidderId,
        reason: e.payload.reason,
        ...(e.payload.holdRef === undefined ? {} : { holdRef: e.payload.holdRef }),
      });
    case 'FALLBACK_PROMOTED':
      return digestOf({
        t: 'PromoteRunnerUp',
        lotId: e.payload.lotId,
        disqualifiedBidderId: e.payload.from,
        reason: e.payload.reason,
      });
    default:
      return null;
  }
}

/** Command type implied by one entry; LOT_CLOSING alone is a Tick until a later entry says more. */
function commandTypeOf(e: LedgerEntry): string | null {
  switch (e.type) {
    case 'AUCTION_CREATED':
      return 'CreateAuction';
    case 'LOT_ADDED':
      return 'AddLot';
    case 'BIDDER_REGISTERED':
    case 'CEILING_RAISED':
      return 'RegisterBidder';
    case 'LOT_OPENED':
      return 'OpenLot';
    case 'BID_RECORDED':
    case 'BID_REJECTED':
    case 'END_EXTENDED':
      return 'PlaceBid';
    case 'LOT_HAMMERED':
      return 'Hammer';
    case 'LOT_UNSOLD':
      return e.payload.reason === 'no_valid_winner' ? 'PromoteRunnerUp' : 'Hammer';
    case 'FALLBACK_PROMOTED':
    case 'CANDIDATE_SKIPPED':
      return 'PromoteRunnerUp';
    case 'CEILING_REVOKED':
      return 'RevokeCeiling';
    case 'LOT_ABORTED':
      return 'AbortLot';
    case 'LOT_SETTLED':
      return 'CompleteLot';
    case 'SETTLEMENT_STATE':
      return 'RecordSettlement';
    case 'LOT_CLOSING':
      return 'Tick';
    default:
      return null;
  }
}

function nextSeen(seen: SeenCommand | undefined, e: LedgerEntry): SeenCommand | null {
  const t = commandTypeOf(e);
  const body = entryBody(e);
  const rejected = e.type === 'BID_REJECTED' ? e.payload.reason : null;
  if (seen === undefined) return { seq: e.seq, body, type: t, rejected };
  const provisional = seen.body === null && seen.type === 'Tick';
  const type = provisional ? (t ?? seen.type) : (seen.type ?? t);
  const nb = seen.body ?? body;
  const rej = seen.rejected ?? rejected;
  if (type === seen.type && nb === seen.body && rej === seen.rejected) return null;
  return { seq: seen.seq, body: nb, type, rejected: rej };
}

/** Mutates a seen-command index the caller owns; replay uses it to stay linear (R-ENG-118). */
export function recordCommandInto(commands: Record<string, SeenCommand>, e: LedgerEntry): void {
  if (e.cmd === null) return;
  const next = nextSeen(commands[e.cmd], e);
  if (next !== null) commands[e.cmd] = next;
}

/** Adds an entry to the seen-command index without mutating the old one. */
export function recordCommand(
  commands: AuctionState['commands'],
  e: LedgerEntry,
): AuctionState['commands'] {
  if (e.cmd === null) return commands;
  const next = nextSeen(commands[e.cmd], e);
  return next === null ? commands : dict({ ...commands, [e.cmd]: next });
}
