import type { RoomState } from '../store/roomReducer';
import type { HoldView, SettlementView } from './ladderModel';

export interface ReceiptSource {
  view: SettlementView | null;
  paddle: number | null;
}

const NONE: ReceiptSource = { view: null, paddle: null };

/**
 * The settlement view for the receipt. When the server sent per-hold data (settlement_update
 * holds) every lane comes from it; otherwise only this bidder's own hold is known.
 */
export function receiptSource(state: RoomState): ReceiptSource {
  const snap = state.snapshot;
  const hammer = state.hammer;
  const settled = snap?.settlement;
  const me = snap?.you?.bidderId ?? state.me?.bidderId ?? null;
  if (snap === null || hammer === null || settled === undefined || me === null) return NONE;
  const row = snap.roster.find((r) => r.bidderId === me);
  if (row === undefined) return NONE;
  const detail = state.settlementDetail;
  if (detail !== undefined) {
    const holds: HoldView[] = detail.holds.map((h) => ({
      paddle: h.paddle,
      name: snap.roster.find((r) => r.paddle === h.paddle)?.name ?? '',
      ceilingCents: h.paddle === row.paddle ? (snap.you?.ceiling ?? 0) : 0,
      state: h.state,
      capturedCents: h.capturedCents,
      releasedCents: h.releasedCents,
      verifiedBy: h.verifiedBy.map((v) => ({
        eventId: v.eventId,
        kind: v.kind,
        at: v.at,
        ...(v.eventType === undefined ? {} : { eventType: v.eventType }),
      })),
      idSuffix: h.idSuffix,
    }));
    return {
      paddle: row.paddle,
      view: {
        lotId: snap.auctionId,
        phase: settled.auctionState,
        winnerPaddle: detail.winnerPaddle,
        hammerPriceCents: hammer.price,
        holds,
        invariants: detail.invariants,
      },
    };
  }
  const ownState = settled.you ?? settled.auctionState;
  const captured = hammer.winnerId === me && ownState === 'CAPTURED';
  return {
    paddle: row.paddle,
    view: {
      lotId: snap.auctionId,
      phase: settled.auctionState,
      winnerPaddle: snap.roster.find((r) => r.bidderId === hammer.winnerId)?.paddle ?? null,
      hammerPriceCents: hammer.price,
      holds: [
        {
          paddle: row.paddle,
          name: row.name,
          ceilingCents: snap.you?.ceiling ?? 0,
          state: ownState,
          capturedCents: captured ? hammer.price : 0,
          releasedCents: 0,
          verifiedBy: [],
          idSuffix: '',
        },
      ],
      invariants: { ok: true, violations: [] },
    },
  };
}
