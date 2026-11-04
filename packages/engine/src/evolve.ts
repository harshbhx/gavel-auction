import { DEFAULT_AUCTION_CONFIG } from './config.js';
import { EngineError } from './errors.js';
import type { LedgerEntry } from './events.js';
import { bidderKey, newLot, recordCommand, withBids } from './state.js';
import type { AuctionState, BidderState, LotState } from './state.js';

function setLot(s: AuctionState, lotId: string, f: (l: LotState) => LotState): AuctionState {
  const lot = s.lots[lotId];
  if (lot === undefined) return s;
  return { ...s, lots: { ...s.lots, [lotId]: f(lot) } };
}

function setBidder(s: AuctionState, key: string, f: (b: BidderState) => BidderState): AuctionState {
  const b = s.bidders[key];
  if (b === undefined) return s;
  return { ...s, bidders: { ...s.bidders, [key]: f(b) } };
}

function apply(s: AuctionState, e: LedgerEntry): AuctionState {
  switch (e.type) {
    case 'AUCTION_CREATED':
      return {
        ...s,
        auctionId: e.auctionId,
        title: e.payload.title,
        config: { ...DEFAULT_AUCTION_CONFIG, ...e.payload.config },
      };
    case 'LOT_ADDED': {
      const { lotId, lot } = e.payload;
      if (s.lots[lotId] !== undefined) return s;
      return {
        ...s,
        lotOrder: [...s.lotOrder, lotId],
        lots: { ...s.lots, [lotId]: newLot(lotId, lot ?? null) },
      };
    }
    case 'BIDDER_REGISTERED': {
      const p = e.payload;
      const key = bidderKey(p.bidderId, p.lotId);
      return {
        ...s,
        bidders: {
          ...s.bidders,
          [key]: {
            bidderId: p.bidderId,
            lotId: p.lotId ?? null,
            ceilingCents: p.ceilingCents,
            holdRef: p.holdRef ?? null,
            revoked: false,
          },
        },
      };
    }
    case 'CEILING_RAISED': {
      const p = e.payload;
      return setBidder(s, bidderKey(p.bidderId, p.lotId), (b) => ({
        ...b,
        ceilingCents: p.ceilingCents,
      }));
    }
    case 'CEILING_REVOKED': {
      const id = e.payload.bidderId;
      const bidders = Object.fromEntries(
        Object.entries(s.bidders).map(([k, b]) => [
          k,
          b.bidderId === id ? { ...b, revoked: true } : b,
        ]),
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
        withBids({ ...l, endsAt: p.endsAtAfter }, [
          ...l.bids,
          {
            bidId: p.bidId,
            bidderId: p.bidderId,
            amountCents: p.amountCents,
            at: e.at,
            seq: e.seq,
            status: 'active',
          },
        ]),
      );
    }
    case 'BID_REJECTED':
      return s;
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
      return setLot(s, e.payload.lotId, (l) => ({ ...l, status: 'CLOSING' }));
    case 'LOT_HAMMERED': {
      const p = e.payload;
      return setLot(s, p.lotId, (l) => ({
        ...l,
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
        ...l,
        status: 'DONE',
        winnerId: null,
        priceCents: null,
        unsoldReason: e.payload.reason,
      }));
    case 'SETTLEMENT_STATE':
      return setLot(s, e.payload.lotId, (l) => ({ ...l, settlement: e.payload.to }));
    case 'LOT_SETTLED':
      return setLot(s, e.payload.lotId, (l) => ({
        ...l,
        status: 'DONE',
        capturedCents: e.payload.capturedCents,
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
