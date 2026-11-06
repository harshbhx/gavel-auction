import type { LedgerEntry } from './events.js';
import { available, bidderFor, committed, scopeKey } from './rules/exposure.js';
import { currentPrice as basicPrice } from './rules/pricing-basic.js';
import type { PricingLot } from './rules/pricing-basic.js';
import { currentPrice as proxyPrice } from './rules/pricing-proxy.js';
import { rank } from './rules/ranking.js';
import type { AuctionState, LotState } from './state.js';
import type { LotStatus, Mode, Ulid } from './types.js';

/** Maps a bidder id to the display name shown to others; names never enter the ledger (R-ENG-110). */
export type AliasOf = (bidderId: string) => string;

export interface PublicLotView {
  lotId: Ulid;
  title: string | null;
  mode: Mode | null;
  status: LotStatus;
  endsAt: number | null;
  /** Current price; null for sealed lots until the hammer. */
  priceCents: number | null;
  /** Alias of the leader; null for sealed lots until the hammer. */
  leaderAlias: string | null;
  bidCount: number;
  /** True when the lot was cancelled before the hammer (kill switch). */
  aborted: boolean;
}

export interface PublicView {
  auctionId: Ulid | null;
  title: string | null;
  closed: boolean;
  lots: PublicLotView[];
}

export interface OwnBidView {
  bidId: string;
  amountCents: number;
  at: number;
  struck: boolean;
}

export interface OwnLotView {
  ceilingCents: number | null;
  committedCents: number;
  availableCents: number;
  revoked: boolean;
  bids: OwnBidView[];
}

export interface BidderLotView extends PublicLotView {
  own: OwnLotView;
}

export interface BidderView {
  auctionId: Ulid | null;
  title: string | null;
  closed: boolean;
  bidderId: Ulid;
  lots: BidderLotView[];
}

const isSealed = (lot: LotState): boolean => lot.config?.mode === 'second_price';
const hammered = (lot: LotState): boolean => lot.status === 'SETTLING' || lot.status === 'DONE';

function pricingLot(lot: LotState): PricingLot | null {
  const c = lot.config;
  return c === null ? null : { mode: c.mode, reserveCents: c.reserveCents, increment: c.increment };
}

function publicLot(lot: LotState, aliasOf: AliasOf): PublicLotView {
  const pl = pricingLot(lot);
  const active = lot.bids.filter((b) => b.status === 'active');
  let priceCents: number | null = null;
  let leader: string | null = null;
  if (hammered(lot)) {
    priceCents = lot.priceCents;
    leader = lot.winnerId;
  } else if (pl !== null && !isSealed(lot)) {
    const ranked = rank(lot.bids);
    priceCents = pl.mode === 'proxy' ? proxyPrice(pl, ranked) : basicPrice(pl, ranked);
    leader = lot.leaderId;
  }
  return {
    lotId: lot.lotId,
    title: lot.config?.title ?? null,
    mode: lot.config?.mode ?? null,
    status: lot.status,
    endsAt: lot.endsAt,
    priceCents,
    leaderAlias: leader === null ? null : aliasOf(leader),
    bidCount: active.length,
    aborted: lot.abortReason !== null,
  };
}

/** R-ENG-106, R-ENG-109, R-ENG-110: what any viewer may see; never a ceiling, hold or maximum. */
export function projectPublic(state: AuctionState, aliasOf: AliasOf): PublicView {
  return {
    auctionId: state.auctionId,
    title: state.title,
    closed: state.closed,
    lots: state.lotOrder.flatMap((id) => {
      const lot = state.lots[id];
      return lot === undefined ? [] : [publicLot(lot, aliasOf)];
    }),
  };
}

/** R-ENG-107, R-ENG-045: the public view plus the bidder's own ceiling, amounts and bids. */
export function projectBidder(state: AuctionState, bidderId: Ulid, aliasOf: AliasOf): BidderView {
  const lots = state.lotOrder.flatMap((id) => {
    const lot = state.lots[id];
    if (lot === undefined) return [];
    const rec = bidderFor(state, bidderId, id);
    const own: OwnLotView = {
      ceilingCents: rec?.ceilingCents ?? null,
      committedCents: committed(state, bidderId, scopeKey(state, id)),
      availableCents: available(state, bidderId, id),
      revoked: rec?.revoked ?? false,
      bids: lot.bids
        .filter((b) => b.bidderId === bidderId)
        .map((b) => ({
          bidId: b.bidId,
          amountCents: b.amountCents,
          at: b.at,
          struck: b.status === 'struck',
        })),
    };
    return [{ ...publicLot(lot, aliasOf), own }];
  });
  return {
    auctionId: state.auctionId,
    title: state.title,
    closed: state.closed,
    bidderId,
    lots,
  };
}

/** A ledger entry as shown to an auditor; `redacted` marks a sealed amount that was withheld. */
export type AuditorEntry = Omit<LedgerEntry, 'payload'> & {
  payload: Record<string, unknown>;
  redacted?: true;
};

export interface AuditorOptions {
  /** Show sealed amounts before the hammer; only for an authorised caller (R-ENG-108). */
  full?: boolean;
}

/**
 * R-ENG-108: the whole ledger. Amounts of bids on a sealed lot, and the audit
 * fields that repeat them or identify the recording (transcript, parsedCents,
 * utteranceId, audio offsets), are withheld until that lot is hammered.
 * Library only: no server path calls this yet.
 */
export function projectAuditor(
  entries: readonly LedgerEntry[],
  opts: AuditorOptions = {},
): AuditorEntry[] {
  const sealed = new Set<string>();
  const done = new Set<string>();
  for (const e of entries) {
    if (e.type === 'LOT_ADDED' && e.payload.lot?.mode === 'second_price')
      sealed.add(e.payload.lotId);
    if (e.type === 'LOT_HAMMERED' || e.type === 'LOT_UNSOLD') done.add(e.payload.lotId);
  }
  return entries.map((e): AuditorEntry => {
    if (
      opts.full === true ||
      (e.type !== 'BID_RECORDED' && e.type !== 'BID_REJECTED') ||
      !sealed.has(e.payload.lotId) ||
      done.has(e.payload.lotId)
    ) {
      return e as AuditorEntry;
    }
    const payload: Record<string, unknown> = { ...e.payload, amountCents: null };
    delete payload['amountRaw'];
    const audit: Record<string, unknown> = { ...e.payload.audit };
    // Anything that repeats the amount or ties the bid to a recording stays private too.
    delete audit['transcript'];
    delete audit['parsedCents'];
    delete audit['utteranceId'];
    delete audit['audioStartMs'];
    delete audit['audioEndMs'];
    payload['audit'] = audit;
    return { ...e, payload, redacted: true } as AuditorEntry;
  });
}
