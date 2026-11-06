import type { SettlementState } from '../wire';
import type { RoomState } from '../store/roomReducer';
import type { HoldView, SettlementView } from './ladderModel';

export interface ReceiptSource {
  /** Holds none but this viewer's own: other bidders are never part of a personal view. */
  view: SettlementView | null;
  paddle: number | null;
  /** Server time of the settle event for this hold; null when the server has not said. */
  at: number | null;
  /** True when this viewer was charged as the runner-up after the first winner could not be. */
  runnerUp: boolean;
  /** True when the server sent per-hold data (ids, confirmations, invariants). */
  detail: boolean;
}

const NONE: ReceiptSource = { view: null, paddle: null, at: null, runnerUp: false, detail: false };

const FINAL: readonly SettlementState[] = ['CAPTURED', 'SETTLED'];

/**
 * The settlement view for the receipt, limited to this bidder's own hold. Amounts come from the
 * server (the per-hold data, or the captured amount of the settlement update), never from the
 * hammer price, and the time is the server time of the settle event.
 */
export function receiptSource(state: RoomState): ReceiptSource {
  const snap = state.snapshot;
  const hammer = state.hammer;
  const settled = snap?.settlement;
  const me = snap?.you?.bidderId ?? state.me?.bidderId ?? null;
  if (snap === null || hammer === null || settled === undefined || me === null) return NONE;
  const row = snap.roster.find((r) => r.bidderId === me);
  if (row === undefined) return NONE;
  const ownState = settled.you ?? settled.auctionState;
  const meta = state.settlementMeta;
  const at = meta !== undefined && FINAL.includes(meta.state) ? meta.at : null;
  const hammerPaddle = snap.roster.find((r) => r.bidderId === hammer.winnerId)?.paddle ?? null;
  const isHammerWinner = hammer.winnerId === me;
  const detail = state.settlementDetail;
  const own = state.ownHold;
  const remainder = own !== undefined && own.bidderId === me ? { remainder: own.remainder } : {};
  if (detail !== undefined) {
    const holds: HoldView[] = detail.holds
      .filter((h) => h.paddle === row.paddle)
      .map((h) => ({
        paddle: h.paddle,
        name: row.name,
        ceilingCents: snap.you?.ceiling ?? 0,
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
        ...remainder,
      }));
    return {
      paddle: row.paddle,
      at,
      runnerUp: detail.winnerPaddle === row.paddle && !isHammerWinner,
      detail: true,
      view: {
        lotId: snap.auctionId,
        phase: settled.auctionState,
        winnerPaddle: detail.winnerPaddle,
        ...(isHammerWinner ? { hammerPriceCents: hammer.price } : {}),
        holds,
        invariants: detail.invariants,
      },
    };
  }
  // No per-hold data: only the captured amount the server named counts as charged.
  const capturedCents = meta?.capturedCents ?? 0;
  const promoted = !isHammerWinner && ownState === 'CAPTURED';
  const wins = isHammerWinner || promoted;
  return {
    paddle: row.paddle,
    at,
    runnerUp: promoted,
    detail: false,
    view: {
      lotId: snap.auctionId,
      phase: settled.auctionState,
      winnerPaddle: wins ? row.paddle : hammerPaddle,
      ...(isHammerWinner ? { hammerPriceCents: hammer.price } : {}),
      holds: [
        {
          paddle: row.paddle,
          name: row.name,
          ceilingCents: snap.you?.ceiling ?? 0,
          state: ownState,
          capturedCents: wins ? capturedCents : 0,
          releasedCents: 0,
          verifiedBy: [],
          idSuffix: '',
          ...remainder,
        },
      ],
      invariants: { ok: true, violations: [] },
    },
  };
}

/**
 * The public screen view: only the winning lane, with no name and no confirmation ids, so the
 * projector never shows more than a paddle number.
 */
export function publicSource(state: RoomState): SettlementView | null {
  const snap = state.snapshot;
  const settled = snap?.settlement;
  const detail = state.settlementDetail;
  if (snap === null || settled === undefined || detail === undefined) return null;
  const holds: HoldView[] = detail.holds
    .filter((h) => h.paddle === detail.winnerPaddle)
    .map((h) => ({
      paddle: h.paddle,
      name: '',
      // Only the winner's lane is shown, so its own total is what the totals line balances.
      ceilingCents: h.capturedCents + h.releasedCents,
      state: h.state,
      capturedCents: h.capturedCents,
      releasedCents: h.releasedCents,
      verifiedBy: [],
      idSuffix: '',
    }));
  return {
    lotId: snap.auctionId,
    phase: settled.auctionState,
    winnerPaddle: detail.winnerPaddle,
    holds,
    invariants: detail.invariants,
  };
}
