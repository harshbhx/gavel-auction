import {
  CROCKFORD,
  isUlid,
  type AuctionId,
  type BidderId,
  type Cents,
  type MsgId,
} from '@gavel/shared';
import { PendingBids } from '../store/localEvents';
import { roomStore, type RoomStore } from '../store/roomStore';
import type { BidSource } from '../wire';
import { ConnectionManager, setActiveConnection } from './connection';
import { bindResync } from './resync';
import type { Transport } from './transport';
import { WebSocketTransport } from './wsTransport';

/** Socket path served by the server host. */
export const WS_PATH = '/ws';

export interface LiveRoomOptions {
  /** Base of the socket endpoint, such as ws://localhost:8787. */
  wsBase: string;
  roomId: string;
  /** Session token: a bidder token, an auctioneer token, or a screen token. */
  token: string;
  /** Set for a bidder device; the store then knows which registered message is its own. */
  bidderId?: string;
  store?: RoomStore;
  /** Test seam: replaces the WebSocket transport. */
  transport?: Transport;
}

export interface LiveRoom {
  connection: ConnectionManager;
  pending: PendingBids;
  /** Sends a bid in cents. Returns the message id used. */
  bid(amount: Cents, source: BidSource, bidderId?: BidderId): MsgId;
  stop(): void;
}

/** A fresh message id in the shared ULID format. */
export function newMsgId(): MsgId {
  const bytes = new Uint8Array(26);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  bytes.forEach((b, i) => {
    const digit = CROCKFORD.charAt(b % 32);
    out += i === 0 ? CROCKFORD.charAt(b % 8) : digit;
  });
  return out as MsgId;
}

export function socketUrl(wsBase: string): string {
  return `${wsBase.replace(/\/+$/, '')}${WS_PATH}`;
}

/**
 * Joins one room over the real transport: enters the room in the store, sends `join` with the
 * session token and resume point on every (re)open, feeds every server message to the store and
 * to the pending-bid tracker, and re-joins when the store asks for a resync. Returns null when
 * the room id is not a valid auction id.
 */
export function startLiveRoom(opts: LiveRoomOptions): LiveRoom | null {
  if (!isUlid(opts.roomId)) return null;
  const store = opts.store ?? roomStore;
  const auctionId = opts.roomId as AuctionId;
  const transport = opts.transport ?? new WebSocketTransport(socketUrl(opts.wsBase));

  store.enter(opts.roomId);
  store.dispatch({ kind: 'identify', bidderId: opts.bidderId ?? null });

  const pending = new PendingBids({
    send: (msg) => transport.send(msg),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as number),
    newId: newMsgId,
  });
  const connection = new ConnectionManager({
    transport,
    auctionId,
    getLastSeq: () => store.getState().lastSeq,
    getToken: () => opts.token,
    onMessage: (msg) => {
      store.dispatch({ kind: 'wire', msg });
      pending.handle(msg);
      // A snapshot after a gap tells which unanswered bids the server did accept.
      if (msg.t === 'state') pending.reconcile(msg.snapshot);
    },
  });
  const unbind = bindResync(store, { requestSnapshot: () => connection.reconnect() });
  setActiveConnection(connection);
  connection.start();

  return {
    connection,
    pending,
    bid: (amount, source, bidderId) => pending.submitBid(amount, source, bidderId),
    stop: () => {
      unbind();
      connection.stop();
      pending.dispose();
      setActiveConnection(null);
    },
  };
}
