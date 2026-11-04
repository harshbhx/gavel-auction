import type { ConfirmRequest, SettlementState } from '../wire';
import type { BidRecord, RoomState } from './roomReducer';

export type Selector<T> = (state: RoomState) => T;

/** Caches the last result per input state object, so useSyncExternalStore sees a stable value. */
function memo<T>(select: Selector<T>): Selector<T> {
  let lastState: RoomState | null = null;
  let lastResult: T;
  return (state) => {
    if (lastState !== state) {
      lastResult = select(state);
      lastState = state;
    }
    return lastResult;
  };
}

export type PriceView = NonNullable<RoomState['snapshot']>['price'];

export type MyStatus = 'watching' | 'none' | 'leading' | 'outbid' | 'atCeiling' | 'won' | 'lost';

export interface CeilingUsage {
  /** Highest amount this bidder has bid in the recent window. */
  usedCents: number;
  maxCents: number;
}

export interface LadderRow {
  paddle: number;
  name: string;
  state: SettlementState;
  ceilingCents: number;
  capturedCents: number;
  releasedCents: number;
}

export const selectPrice: Selector<PriceView | null> = memo((s) => s.snapshot?.price ?? null);

export const selectMyStatus: Selector<MyStatus> = memo((s) => {
  const you = s.snapshot?.you;
  if (you === undefined) return 'watching';
  if (s.hammer !== null) return s.hammer.winnerPaddle === you.paddle ? 'won' : 'lost';
  const price = s.snapshot?.price;
  if (price?.leaderPaddle === you.paddle) return 'leading';
  const hasBid = s.recentBids.some((b) => b.paddle === you.paddle);
  if (!hasBid) return 'none';
  return price !== undefined && price.nextMinCents > you.ceilingCents ? 'atCeiling' : 'outbid';
});

export const selectCeilingUsage: Selector<CeilingUsage | null> = memo((s) => {
  const you = s.snapshot?.you;
  if (you === undefined) return null;
  const usedCents = s.recentBids
    .filter((b) => b.paddle === you.paddle)
    .reduce((max, b) => Math.max(max, b.amountCents), 0);
  return { usedCents, maxCents: you.ceilingCents };
});

export const selectLadderRows: Selector<readonly LadderRow[]> = memo((s) =>
  (s.snapshot?.settlement?.holds ?? []).map((h) => ({
    paddle: h.paddle,
    name: h.name,
    state: h.state,
    ceilingCents: h.ceilingCents,
    capturedCents: h.capturedCents,
    releasedCents: h.releasedCents,
  })),
);

/** Newest bid first. */
export const selectStream: Selector<readonly BidRecord[]> = memo((s) =>
  [...s.recentBids].reverse(),
);

export const selectConfirmQueue: Selector<readonly ConfirmRequest[]> = memo(
  (s) => s.confirmRequests,
);

export const selectors = {
  price: selectPrice,
  myStatus: selectMyStatus,
  ceilingUsage: selectCeilingUsage,
  ladderRows: selectLadderRows,
  stream: selectStream,
  confirmQueue: selectConfirmQueue,
} as const;
