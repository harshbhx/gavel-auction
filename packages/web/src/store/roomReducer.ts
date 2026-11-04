import type {
  AuditEvent,
  ConfirmRequest,
  Hammer,
  JoinSend,
  RoomSnapshot,
  ServerMessage,
} from '../wire';

export interface BidRecord {
  seq: number;
  paddle: number;
  amountCents: number;
}

export interface RoomState {
  roomId: string;
  /** Highest seq applied. Snapshots set it. */
  lastSeq: number;
  resyncing: boolean;
  snapshot: RoomSnapshot | null;
  recentBids: readonly BidRecord[];
  confirmRequests: readonly ConfirmRequest[];
  hammer: Hammer | null;
  audit: readonly AuditEvent[];
  lastError: { code: string; message: string } | null;
}

export type RoomEvent =
  | { kind: 'wire'; msg: ServerMessage }
  /** Local event: the connection was replaced, so seq numbering starts over. */
  | { kind: 'reset' };

export type Effect = { type: 'send'; msg: JoinSend };

export interface ReduceResult {
  state: RoomState;
  effects: Effect[];
}

const MAX_RECENT_BIDS = 50;

export function initialRoomState(roomId: string): RoomState {
  return {
    roomId,
    lastSeq: 0,
    resyncing: false,
    snapshot: null,
    recentBids: [],
    confirmRequests: [],
    hammer: null,
    audit: [],
    lastError: null,
  };
}

function withSnapshot(state: RoomState, update: (snap: RoomSnapshot) => RoomSnapshot): RoomState {
  return state.snapshot === null ? state : { ...state, snapshot: update(state.snapshot) };
}

function apply(state: RoomState, msg: ServerMessage): RoomState {
  switch (msg.t) {
    case 'state': {
      const { room, lot, price, bidders, you, settlement } = msg;
      const snapshot: RoomSnapshot = {
        room,
        lot,
        price,
        bidders,
        ...(you === undefined ? {} : { you }),
        ...(settlement === undefined ? {} : { settlement }),
      };
      // A snapshot is the whole truth: everything derived from earlier messages is reset.
      return { ...initialRoomState(state.roomId), lastSeq: msg.seq, snapshot };
    }
    case 'price':
      return withSnapshot(state, (s) => ({
        ...s,
        lot:
          s.lot === null || msg.closesAt === undefined
            ? s.lot
            : { ...s.lot, closesAt: msg.closesAt },
        price: {
          currentCents: msg.currentCents,
          leaderPaddle: msg.leaderPaddle,
          nextMinCents: msg.nextMinCents,
          bidCount: msg.bidCount,
        },
      }));
    case 'bid':
      return {
        ...state,
        recentBids: [
          ...state.recentBids,
          { seq: msg.seq, paddle: msg.paddle, amountCents: msg.amountCents },
        ].slice(-MAX_RECENT_BIDS),
      };
    case 'registered':
      return withSnapshot(state, (s) => ({
        ...s,
        you: {
          bidderId: msg.bidderId,
          paddle: msg.paddle,
          ceilingCents: msg.ceilingCents,
          holdState: 'HELD',
        },
      }));
    case 'confirm_request':
      return {
        ...state,
        confirmRequests: [
          ...state.confirmRequests.filter((c) => c.confirmId !== msg.confirmId),
          msg,
        ],
      };
    case 'confirm_response':
      return {
        ...state,
        confirmRequests: state.confirmRequests.filter((c) => c.confirmId !== msg.confirmId),
      };
    case 'hammer':
      return { ...state, hammer: msg };
    case 'settlement_update':
      return withSnapshot(state, (s) => ({ ...s, settlement: msg.settlement }));
    case 'audit_event':
      return { ...state, audit: [...state.audit, msg] };
    case 'error':
      return { ...state, lastError: { code: msg.code, message: msg.message } };
    case 'join':
    case 'bid_accepted':
    case 'bid_rejected':
      // Bid results are matched by clientBidId in the pending-bid tracker.
      return state;
  }
}

/** Pure: no I/O, no clock. Ignores duplicates, asks for a snapshot on a gap (R-WEB-020..022). */
export function reduce(state: RoomState, ev: RoomEvent): ReduceResult {
  if (ev.kind === 'reset') return { state: initialRoomState(state.roomId), effects: [] };
  const { msg } = ev;
  if (msg.seq <= state.lastSeq) return { state, effects: [] };

  if (msg.t === 'state') return { state: apply(state, msg), effects: [] };

  if (state.resyncing) return { state, effects: [] };

  if (msg.seq > state.lastSeq + 1) {
    return {
      state: { ...state, resyncing: true },
      effects: [
        { type: 'send', msg: { t: 'join', roomId: state.roomId, resumeFromSeq: state.lastSeq } },
      ],
    };
  }

  return { state: { ...apply(state, msg), lastSeq: msg.seq }, effects: [] };
}
