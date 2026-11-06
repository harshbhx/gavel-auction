import { createdConfig } from './config.js';
import { EngineError } from './errors.js';
import type { LedgerEntry } from './events.js';
import {
  bidderKey,
  dict,
  initialState,
  newLot,
  recordCommand,
  recordCommandInto,
  withBids,
  withNewBid,
} from './state.js';
import type { AuctionState, BidderState, LotState, SeenCommand } from './state.js';

function setLot(s: AuctionState, lotId: string, f: (l: LotState) => LotState): AuctionState {
  const lot = s.lots[lotId];
  if (lot === undefined) return s;
  return { ...s, lots: dict({ ...s.lots, [lotId]: f(lot) }) };
}

/** The lot without the optional markers named, so it digests as if they were never set. */
function without(l: LotState, ...keys: readonly ('pausedRemainingMs' | 'closingSeq')[]): LotState {
  const kept = Object.entries(l).filter(([k]) => !(keys as readonly string[]).includes(k));
  return Object.fromEntries(kept) as unknown as LotState;
}

/** The lot without its pause marker, so a resumed lot digests like one that was never paused. */
const unpaused = (l: LotState): LotState => without(l, 'pausedRemainingMs');

/** A bidder record revoked for good: the lot-only marker of an earlier revocation goes. */
function revokedForGood(b: BidderState): BidderState {
  const copy: Record<string, unknown> = { ...b, revoked: true };
  delete copy['revokedLotOnly'];
  return copy as unknown as BidderState;
}

function setBidder(s: AuctionState, key: string, f: (b: BidderState) => BidderState): AuctionState {
  const b = s.bidders[key];
  if (b === undefined) return s;
  return { ...s, bidders: dict({ ...s.bidders, [key]: f(b) }) };
}

function apply(s: AuctionState, e: LedgerEntry, inPlace = false): AuctionState {
  switch (e.type) {
    case 'AUCTION_CREATED':
      // A ledger has one genesis; a second AUCTION_CREATED must not overwrite config mid-auction.
      if (s.auctionId !== null) return s;
      // Older entries hold a partial config; it is filled from frozen defaults (R12-E13).
      return {
        ...s,
        auctionId: e.auctionId,
        title: e.payload.title,
        config: createdConfig(e.payload.config),
      };
    case 'LOT_ADDED': {
      const { lotId, lot } = e.payload;
      if (s.lots[lotId] !== undefined) return s;
      return {
        ...s,
        lotOrder: [...s.lotOrder, lotId],
        lots: dict({ ...s.lots, [lotId]: newLot(lotId, lot ?? null) }),
      };
    }
    case 'BIDDER_REGISTERED': {
      const p = e.payload;
      const key = bidderKey(p.bidderId, p.lotId);
      return {
        ...s,
        bidders: dict({
          ...s.bidders,
          [key]: {
            bidderId: p.bidderId,
            lotId: p.lotId ?? null,
            ceilingCents: p.ceilingCents,
            holdRef: p.holdRef ?? null,
            revoked: false,
          },
        }),
      };
    }
    case 'CEILING_RAISED': {
      const p = e.payload;
      return setBidder(s, bidderKey(p.bidderId, p.lotId), (b) => ({
        ...b,
        ceilingCents: p.ceilingCents,
        holdRef: p.holdRef ?? b.holdRef,
      }));
    }
    case 'CEILING_REVOKED': {
      const id = e.payload.bidderId;
      const lotId = e.payload.lotId;
      // Under holdScope lot the end of one lot's hold revokes that lot's record only (R12-E09).
      if (lotId !== undefined) {
        return setBidder(s, bidderKey(id, lotId), (b) =>
          b.revoked ? b : { ...b, revoked: true, revokedLotOnly: true },
        );
      }
      const bidders = dict(
        Object.fromEntries(
          Object.entries(s.bidders).map(([k, b]) => [k, b.bidderId === id ? revokedForGood(b) : b]),
        ),
      );
      return { ...s, bidders };
    }
    case 'LOT_OPENED':
      return setLot(s, e.payload.lotId, (l) => ({
        ...l,
        status: 'OPEN',
        openedAt: e.at,
        endsAt: e.payload.endsAt,
      }));
    case 'BID_RECORDED': {
      const p = e.payload;
      return setLot(s, p.lotId, (l) =>
        withNewBid(
          { ...l, endsAt: p.endsAtAfter },
          {
            bidId: p.bidId,
            bidderId: p.bidderId,
            amountCents: p.amountCents,
            at: e.at,
            seq: e.seq,
            status: 'active',
          },
          inPlace,
        ),
      );
    }
    case 'BID_REJECTED':
      return setLot(s, e.payload.lotId, (l) => ({ ...l, rejectedBids: l.rejectedBids + 1 }));
    case 'BID_STRUCK': {
      const p = e.payload;
      return setLot(s, p.lotId, (l) =>
        withBids(
          l,
          l.bids.map((b) => (b.bidId === p.bidId ? { ...b, status: 'struck' as const } : b)),
        ),
      );
    }
    case 'END_EXTENDED':
      return setLot(s, e.payload.lotId, (l) => ({
        ...l,
        endsAt: e.payload.endsAtAfter,
        extensions: e.payload.extensions,
      }));
    case 'LOT_CLOSING':
      // Kept only while CLOSING, so the hammer can name this entry (R12-E11).
      return setLot(s, e.payload.lotId, (l) => ({ ...l, status: 'CLOSING', closingSeq: e.seq }));
    case 'LOT_HAMMERED': {
      const p = e.payload;
      return setLot(s, p.lotId, (l) => ({
        ...without(l, 'closingSeq'),
        status: 'SETTLING',
        winnerId: p.winnerId,
        priceCents: p.priceCents,
        candidates: p.candidates,
        endsAt: p.endsAt,
        extensions: p.extensions,
        closedAtSeq: p.closedAtSeq,
        depth: 0,
      }));
    }
    case 'FALLBACK_PROMOTED': {
      const p = e.payload;
      return setLot(s, p.lotId, (l) => ({
        ...l,
        winnerId: p.to,
        priceCents: p.priceCents,
        depth: p.depth,
        demoted: [...l.demoted, p.from],
      }));
    }
    case 'CANDIDATE_SKIPPED': {
      const p = e.payload;
      return setLot(s, p.lotId, (l) => ({
        ...l,
        skipped: [
          ...l.skipped,
          { bidderId: p.bidderId, reason: p.reason, depth: p.depth, priceCents: p.priceCents },
        ],
      }));
    }
    case 'LOT_UNSOLD':
      return setLot(s, e.payload.lotId, (l) => ({
        ...without(l, 'closingSeq'),
        status: 'DONE',
        winnerId: null,
        priceCents: null,
        unsoldReason: e.payload.reason,
        // A lot that was hammered and then lost its last candidate releases its hold (ENG-R2-11).
        // A lot waiting for manual review keeps that state; it is never overwritten (R4-E10).
        settlement:
          l.status === 'SETTLING' &&
          l.settlement !== 'SETTLED' &&
          l.settlement !== 'FAILED_NEEDS_REVIEW'
            ? 'VOIDING'
            : l.settlement,
      }));
    case 'LOT_ABORTED':
      return setLot(s, e.payload.lotId, (l) => ({
        ...without(l, 'pausedRemainingMs', 'closingSeq'),
        status: 'DONE',
        winnerId: null,
        priceCents: null,
        abortReason: e.payload.reason,
      }));
    case 'LOT_PAUSED':
      return setLot(s, e.payload.lotId, (l) => ({
        ...l,
        pausedRemainingMs: e.payload.remainingMs,
      }));
    case 'LOT_RESUMED': {
      // The clock stood still for endsAtAfter - endsAtBefore ms; the hard close moves with it
      // (R12-E08). Kept only once a pause moved the clock.
      const shift = e.payload.endsAtAfter - e.payload.endsAtBefore;
      return setLot(s, e.payload.lotId, (l) => {
        const next = { ...unpaused(l), endsAt: e.payload.endsAtAfter };
        if (shift <= 0) return next;
        return { ...next, pausedTotalMs: (l.pausedTotalMs ?? 0) + shift };
      });
    }
    case 'LOT_EXTENDED':
      return setLot(s, e.payload.lotId, (l) => ({ ...l, endsAt: e.payload.endsAtAfter }));
    case 'SETTLEMENT_STATE':
      return setLot(s, e.payload.lotId, (l) => ({
        ...l,
        settlement: e.payload.to,
        captureSeen: l.captureSeen || e.payload.to === 'CAPTURED',
      }));
    case 'LOT_SETTLED':
      return setLot(s, e.payload.lotId, (l) => ({
        ...l,
        status: 'DONE',
        capturedCents: e.payload.capturedCents,
        settlement: 'SETTLED',
      }));
    case 'AUCTION_CLOSED':
      return { ...s, closed: true, closedHeadHash: e.payload.headHash };
    default:
      throw new EngineError('unknown_entry_type', String((e as { type: unknown }).type));
  }
}

/**
 * The only way state changes (R-ENG-092). Pure and total for every entry type
 * `decide` can produce; unknown types throw `unknown_entry_type` (R-ENG-095).
 */
export function evolve(s: AuctionState, e: LedgerEntry): AuctionState {
  const next = apply(s, e);
  const commands = recordCommand(next.commands, e);
  return { ...next, commands, head: { seq: e.seq, at: e.at, hash: e.hash } };
}

/** Seen-command indexes created by `evolveOwned`; only these are ever mutated. */
const ownedCommands = new WeakSet<object>();

/**
 * Folds new entries into a state the caller owns and keeps (a cached live state). The
 * seen-command index and each lot's bid list are extended in place after the first call, so
 * the cost of one entry does not grow with the history. The state passed in is consumed: do not
 * keep an earlier snapshot of it and expect it to stay unchanged. Result equals `entries.reduce(evolve, s)`.
 */
export function evolveOwned(s: AuctionState, entries: readonly LedgerEntry[]): AuctionState {
  const last = entries[entries.length - 1];
  if (last === undefined) return s;
  const commands: Record<string, SeenCommand> = ownedCommands.has(s.commands)
    ? s.commands
    : dict({ ...s.commands });
  ownedCommands.add(commands);
  let next = s;
  for (const e of entries) {
    next = apply(next, e, true);
    recordCommandInto(commands, e);
  }
  return { ...next, commands, head: { seq: last.seq, at: last.at, hash: last.hash } };
}

/**
 * Reduces a whole ledger from the initial state. Same result as folding `evolve`
 * but the seen-command index is built once instead of copied per entry (R-ENG-118).
 */
export function evolveAll(entries: readonly LedgerEntry[]): AuctionState {
  const commands: Record<string, SeenCommand> = dict();
  let s: AuctionState = initialState;
  for (const e of entries) {
    s = apply(s, e);
    recordCommandInto(commands, e);
  }
  const last = entries[entries.length - 1];
  if (last === undefined) return s;
  return { ...s, commands, head: { seq: last.seq, at: last.at, hash: last.hash } };
}
