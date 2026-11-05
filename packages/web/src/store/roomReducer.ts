import type {
  AuditPayload,
  ConfirmRequestMsg,
  HammerMsg,
  RoomSnapshot,
  ServerMessage,
} from '../wire';

export interface BidRecord {
  seq: number;
  bidderId: string;
  /** Null when the server did not name a paddle for the leader. */
  paddle: number | null;
  amount: number;
}

/** The bidder this session registered as, from the `registered` message. */
export interface Identity {
  bidderId: string;
  paddle: number;
  ceiling: number | null;
}

export interface RoomState {
  auctionId: string;
  /** Highest seq applied. Snapshots set it. */
  lastSeq: number;
  /**
   * Message types already applied at `lastSeq`. The server sends bid_accepted, price and
   * audit_event for one accepted bid under a single seq (R-RT-036), so a repeat of the same
   * type is a duplicate but a different type is a new frame.
   */
  appliedAtSeq: readonly string[];
  resyncing: boolean;
  /** Messages that arrived while a resync was pending, oldest first. */
  held: readonly ServerMessage[];
  snapshot: RoomSnapshot | null;
  leaderPaddle: number | null;
  /** Set by the app from the session token. A `registered` for anyone else is ignored. */
  expectedBidderId: string | null;
  me: Identity | null;
  recentBids: readonly BidRecord[];
  confirmRequests: readonly ConfirmRequestMsg[];
  hammer: HammerMsg | null;
  audit: readonly AuditPayload[];
  /** True when audit rows may be missing: older ones were dropped or the snapshot window was full. */
  auditTruncated: boolean;
  lastError: { code: string; message: string; retryAfterMs: number | null } | null;
}

export type RoomEvent =
  | { kind: 'wire'; msg: ServerMessage }
  /** Local event: the connection was replaced, so seq numbering starts over. */
  | { kind: 'reset' }
  /** Local event: this session belongs to the given bidder (from the stored session). */
  | { kind: 'identify'; bidderId: string | null }
  /** Local event: a confirmation was answered, so it leaves the queue. */
  | { kind: 'confirm_resolved'; confirmId: string };

/** Ask the connection layer to send a join with the stored token and the current lastSeq. */
export type Effect = { type: 'resync'; lastSeq: number };

export interface ReduceResult {
  state: RoomState;
  effects: Effect[];
}

const MAX_RECENT_BIDS = 50;
const MAX_AUDIT = 200;
/** The most audit rows a snapshot carries (the shared schema caps recentAudit at 50). */
const SNAPSHOT_AUDIT_ROWS = 50;
export const MAX_HELD = 200;

export function initialRoomState(auctionId: string): RoomState {
  return {
    auctionId,
    lastSeq: 0,
    appliedAtSeq: [],
    resyncing: false,
    held: [],
    snapshot: null,
    leaderPaddle: null,
    expectedBidderId: null,
    me: null,
    recentBids: [],
    confirmRequests: [],
    hammer: null,
    audit: [],
    auditTruncated: false,
    lastError: null,
  };
}

function withSnapshot(state: RoomState, update: (snap: RoomSnapshot) => RoomSnapshot): RoomState {
  return state.snapshot === null ? state : { ...state, snapshot: update(state.snapshot) };
}

/** A snapshot is the truth about the room, but not about what only this client knows. */
function applySnapshot(state: RoomState, msg: Extract<ServerMessage, { t: 'state' }>): RoomState {
  const snap = msg.snapshot;
  const open = snap.status === 'OPEN' || snap.status === 'PAUSED' || snap.status === 'SCHEDULED';
  return {
    ...initialRoomState(state.auctionId === '' ? snap.auctionId : state.auctionId),
    lastSeq: msg.seq,
    // The snapshot already contains what price and audit_event at this seq would add.
    appliedAtSeq: ['state', 'price', 'audit_event'],
    snapshot: snap,
    // A snapshot does not list this client's own bids, but they are still true: keep them.
    recentBids:
      state.auctionId === '' || state.auctionId === snap.auctionId ? state.recentBids : [],
    leaderPaddle: snap.roster.find((r) => r.bidderId === snap.leaderId)?.paddle ?? null,
    expectedBidderId: state.expectedBidderId,
    me: state.me,
    // The hammer already fell and the snapshot does not carry it, so keep it unless the lot reopened.
    hammer: open ? null : state.hammer,
    // The snapshot does not carry confirmations either: keep the ones that have not expired.
    confirmRequests: state.confirmRequests.filter((c) => c.expiresAt > msg.ts),
    audit: [...snap.recentAudit],
    // The snapshot carries at most SNAPSHOT_AUDIT_ROWS rows: a full window may hide older ones.
    auditTruncated: snap.recentAudit.length >= SNAPSHOT_AUDIT_ROWS,
  };
}

/** A price frame that repeats the current leader and amount (a seq filler) is not a new bid. */
function isRepeatOfLastBid(bids: readonly BidRecord[], bidderId: string, amount: number): boolean {
  const last = bids.at(-1);
  return last !== undefined && last.bidderId === bidderId && last.amount === amount;
}

function apply(state: RoomState, msg: Exclude<ServerMessage, { t: 'state' }>): RoomState {
  switch (msg.t) {
    case 'price':
      return withSnapshot(
        {
          ...state,
          leaderPaddle: msg.leaderPaddle,
          recentBids:
            msg.leaderId === null || isRepeatOfLastBid(state.recentBids, msg.leaderId, msg.price)
              ? state.recentBids
              : [
                  ...state.recentBids,
                  {
                    seq: msg.seq,
                    bidderId: msg.leaderId,
                    paddle: msg.leaderPaddle,
                    amount: msg.price,
                  },
                ].slice(-MAX_RECENT_BIDS),
        },
        (s) => ({
          ...s,
          price: msg.price,
          leaderId: msg.leaderId,
          endTs: msg.endTs,
          minNext: msg.minNext,
          paused: msg.paused === true,
          ...(msg.remainingMs === undefined ? {} : { remainingMs: msg.remainingMs }),
          // A price frame on a lot that had not opened yet means it is open now.
          status: s.status === 'SCHEDULED' ? 'OPEN' : s.status,
        }),
      );
    case 'registered': {
      // Only the identity this session was issued: a broadcast must not change who "you" are.
      if (state.expectedBidderId !== null && msg.bidderId !== state.expectedBidderId) return state;
      if (state.me !== null && state.me.bidderId !== msg.bidderId) return state;
      return {
        ...state,
        me: { bidderId: msg.bidderId, paddle: msg.paddle, ceiling: msg.ceiling ?? null },
      };
    }
    case 'confirm_request':
      return {
        ...state,
        confirmRequests: [
          ...state.confirmRequests.filter((c) => c.confirmId !== msg.confirmId),
          msg,
        ],
      };
    case 'hammer':
      return { ...state, hammer: msg };
    case 'settlement_update':
      return withSnapshot(state, (s) =>
        s.settlement !== undefined && msg.rev < s.settlement.rev
          ? s
          : {
              ...s,
              settlement: {
                rev: msg.rev,
                auctionState: msg.auctionState,
                ...(msg.you === undefined ? {} : { you: msg.you }),
              },
            },
      );
    case 'audit_event':
      return {
        ...state,
        audit: [...state.audit, msg.audit].slice(-MAX_AUDIT),
        auditTruncated: state.auditTruncated || state.audit.length + 1 > MAX_AUDIT,
      };
    case 'error':
      return {
        ...state,
        lastError: {
          code: msg.code,
          message: msg.message,
          retryAfterMs: msg.retryAfterMs ?? null,
        },
      };
    case 'bid_accepted':
    case 'bid_rejected':
      // Bid results are matched by mid in the pending-bid tracker.
      return state;
  }
}

type Step = { kind: 'dup' } | { kind: 'gap' } | { kind: 'applied'; state: RoomState };

/** Decide what one sequenced message does to the state, given the current `lastSeq`. */
function step(state: RoomState, msg: Exclude<ServerMessage, { t: 'state' }>): Step {
  const seq = msg.seq ?? 0;
  if (seq < state.lastSeq) return { kind: 'dup' };
  if (seq === state.lastSeq) {
    if (state.lastSeq === 0 || state.appliedAtSeq.includes(msg.t)) return { kind: 'dup' };
    return {
      kind: 'applied',
      state: { ...apply(state, msg), appliedAtSeq: [...state.appliedAtSeq, msg.t] },
    };
  }
  if (seq > state.lastSeq + 1) return { kind: 'gap' };
  return { kind: 'applied', state: { ...apply(state, msg), lastSeq: seq, appliedAtSeq: [msg.t] } };
}

/**
 * Applies the held messages that follow on from the snapshot, in order. Anything after a gap is
 * dropped: if it was real, the next live message shows the gap and asks for a new snapshot.
 */
function drainHeld(state: RoomState): RoomState {
  let current: RoomState = { ...state, held: [] };
  const later = state.held
    .filter((m) => m.seq !== undefined && m.seq >= state.lastSeq)
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  for (const msg of later) {
    if (msg.t === 'state') continue;
    const r = step(current, msg);
    if (r.kind === 'gap') break;
    if (r.kind === 'applied') current = r.state;
  }
  return current;
}

function hold(state: RoomState, msg: ServerMessage): RoomState {
  if (state.held.some((m) => m.seq === msg.seq && m.t === msg.t)) return state;
  return { ...state, held: [...state.held, msg].slice(-MAX_HELD) };
}

/**
 * Pure: no I/O, no clock. Ignores duplicates, asks for a snapshot on a gap and keeps what arrives
 * meanwhile (R-WEB-020..022). While resyncing, a snapshot is accepted at any seq, so a server
 * that restarted its numbering can still recover.
 */
export function reduce(state: RoomState, ev: RoomEvent): ReduceResult {
  switch (ev.kind) {
    case 'reset':
      return {
        state: { ...initialRoomState(state.auctionId), expectedBidderId: state.expectedBidderId },
        effects: [],
      };
    case 'identify':
      return { state: { ...state, expectedBidderId: ev.bidderId }, effects: [] };
    case 'confirm_resolved':
      return {
        state: {
          ...state,
          confirmRequests: state.confirmRequests.filter((c) => c.confirmId !== ev.confirmId),
        },
        effects: [],
      };
    case 'wire':
      break;
  }
  const { msg } = ev;

  // An error with no event behind it has no seq: show it and keep the sequence as it is.
  if (msg.t === 'error' && msg.seq === undefined) {
    return { state: apply(state, msg), effects: [] };
  }
  const seq = msg.seq ?? 0;

  if (msg.t === 'state') {
    // A repeat of the same snapshot changes nothing. Any other seq is a new truth: the transport
    // is ordered, so a lower seq means the server restarted its numbering.
    if (seq === state.lastSeq && !state.resyncing) return { state, effects: [] };
    return { state: drainHeld({ ...applySnapshot(state, msg), held: state.held }), effects: [] };
  }

  if (seq < state.lastSeq) return { state, effects: [] };

  if (state.resyncing) return { state: hold(state, msg), effects: [] };

  const r = step(state, msg);
  if (r.kind === 'dup') return { state, effects: [] };
  if (r.kind === 'gap') {
    return {
      state: { ...hold(state, msg), resyncing: true },
      effects: [{ type: 'resync', lastSeq: state.lastSeq }],
    };
  }
  return { state: r.state, effects: [] };
}
