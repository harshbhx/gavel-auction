import type { ConfirmRequestMsg, SettlementState } from '../wire';
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

export interface PriceView {
  /** Null until the first bid. */
  currentCents: number | null;
  leaderId: string | null;
  leaderPaddle: number | null;
  nextMinCents: number;
  /** When bidding closes, in server time. */
  endTs: number;
  /** The auctioneer froze the clock; `remainingMs` is what resume restores. */
  paused: boolean;
  remainingMs: number | null;
}

export type MyStatus =
  | 'watching'
  | 'none'
  | 'leading'
  | 'outbid'
  | 'atCeiling'
  | 'won'
  | 'lost'
  | 'review';

export interface CeilingUsage {
  /** Highest amount this bidder has bid in the recent window. */
  usedCents: number;
  maxCents: number;
}

/** One bidder in the roster with the hold state the snapshot reports. */
export interface LadderRow {
  bidderId: string;
  paddle: number;
  name: string;
  state: SettlementState;
}

interface You {
  bidderId: string;
  ceiling: number | null;
}

function youOf(s: RoomState): You | null {
  const fromSnapshot = s.snapshot?.you;
  if (fromSnapshot !== undefined) {
    return { bidderId: fromSnapshot.bidderId, ceiling: fromSnapshot.ceiling };
  }
  return s.me === null ? null : { bidderId: s.me.bidderId, ceiling: s.me.ceiling };
}

export const selectPrice: Selector<PriceView | null> = memo((s) => {
  const snap = s.snapshot;
  if (snap === null) return null;
  return {
    currentCents: snap.price,
    leaderId: snap.leaderId,
    leaderPaddle: s.leaderPaddle,
    nextMinCents: snap.minNext,
    endTs: snap.endTs,
    paused: snap.paused === true,
    remainingMs: snap.remainingMs ?? null,
  };
});

/**
 * What bidders should treat the lot as: the server reports a pause as OPEN plus `paused`, and the
 * hammer closes the lot before any later snapshot says so.
 */
export const selectAuctionStatus: Selector<string | null> = memo((s) => {
  const snap = s.snapshot;
  if (snap === null) return null;
  const live = snap.status === 'OPEN' || snap.status === 'PAUSED' || snap.status === 'SCHEDULED';
  if (s.hammer !== null && live) return 'CLOSING';
  if (snap.paused === true && snap.status === 'OPEN') return 'PAUSED';
  return snap.status;
});

export const selectMyStatus: Selector<MyStatus> = memo((s) => {
  const you = youOf(s);
  if (you === null) return 'watching';
  const snap = s.snapshot;
  // Once settlement reports this bidder's own state it outranks the hammer (R-WEB-090): a
  // failed capture or a fallback must not keep showing the hammer's winner as won.
  switch (snap?.settlement?.you) {
    case 'CAPTURED':
      return 'won';
    case 'SETTLED':
    case 'VOIDING':
    case 'FALLBACK_RUNNER_UP':
      return 'lost';
    case 'FAILED_NEEDS_REVIEW':
      return 'review';
    default:
      break;
  }
  if (s.hammer !== null) return s.hammer.winnerId === you.bidderId ? 'won' : 'lost';
  if (snap?.leaderId === you.bidderId) return 'leading';
  const hasBid = s.recentBids.some((b) => b.bidderId === you.bidderId);
  if (!hasBid) return 'none';
  return snap !== null && you.ceiling !== null && snap.minNext > you.ceiling
    ? 'atCeiling'
    : 'outbid';
});

export const selectCeilingUsage: Selector<CeilingUsage | null> = memo((s) => {
  const you = youOf(s);
  if (you === null || you.ceiling === null) return null;
  const usedCents = s.recentBids
    .filter((b) => b.bidderId === you.bidderId)
    .reduce((max, b) => Math.max(max, b.amount), 0);
  return { usedCents, maxCents: you.ceiling };
});

export const selectLadderRows: Selector<readonly LadderRow[]> = memo((s) => {
  const snap = s.snapshot;
  if (snap === null) return [];
  const you = youOf(s);
  return snap.roster
    .filter((r) => r.hold === 'HELD')
    .map((r) => ({
      bidderId: r.bidderId,
      paddle: r.paddle,
      name: r.name,
      // The phase and this bidder's own hold are all the wire says; the rest is HELD.
      state:
        you !== null && r.bidderId === you.bidderId ? (snap.settlement?.you ?? 'HELD') : 'HELD',
    }));
});

/** Newest bid first. */
export const selectStream: Selector<readonly BidRecord[]> = memo((s) =>
  [...s.recentBids].reverse(),
);

export const selectConfirmQueue: Selector<readonly ConfirmRequestMsg[]> = memo(
  (s) => s.confirmRequests,
);

export const selectors = {
  price: selectPrice,
  auctionStatus: selectAuctionStatus,
  myStatus: selectMyStatus,
  ceilingUsage: selectCeilingUsage,
  ladderRows: selectLadderRows,
  stream: selectStream,
  confirmQueue: selectConfirmQueue,
} as const;
