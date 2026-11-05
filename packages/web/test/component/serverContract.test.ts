// @vitest-environment node
import { Cents, EpochMs, decodeClientMsg } from '@gavel/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startLiveRoom, socketUrl, type LiveRoom } from '../../src/net/liveRoom';
import { WebSocketTransport, type SocketLike } from '../../src/net/wsTransport';
import { RoomStore } from '../../src/store/roomStore';
import { selectPrice } from '../../src/store/selectors';
import {
  BASE_TIME,
  auctionId,
  bidId,
  openSnapshot,
  priceMsg,
  roster,
  stateMsg,
} from '../../src/testing/builders';
import { encodeMsg, type ClientMessage, type ServerMessage } from '../../src/wire';

/**
 * A stand-in for the server host. It speaks only encoded frames: what the web client sends is
 * decoded with the shared client decoder, and what it answers is encoded with the shared
 * encoder, so a field that drifts from the shared schemas fails here.
 */
class ServerDouble {
  readonly sockets: FakeSocket[] = [];
  readonly received: ClientMessage[] = [];
  readonly rejected: string[] = [];

  factory = (url: string): SocketLike => {
    const socket = new FakeSocket(url, this);
    this.sockets.push(socket);
    return socket;
  };

  get current(): FakeSocket {
    const last = this.sockets[this.sockets.length - 1];
    if (last === undefined) throw new Error('no socket opened');
    return last;
  }
}

class FakeSocket implements SocketLike {
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;

  constructor(
    readonly url: string,
    private readonly server: ServerDouble,
  ) {}

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  drop(): void {
    this.readyState = 3;
    this.onclose?.();
  }

  push(msg: ServerMessage): void {
    const frame = encodeMsg(msg);
    if (!frame.ok) throw new Error(`server double built an invalid frame: ${frame.error.code}`);
    this.onmessage?.({ data: frame.value });
  }

  send(data: string): void {
    const res = decodeClientMsg(data);
    if (res.ok) this.server.received.push(res.value);
    else this.server.rejected.push(res.code);
  }

  close(): void {
    this.readyState = 3;
  }
}

const id = auctionId();
const TOKEN = 'bidder-token';

describe('web client against the server contract', () => {
  let server: ServerDouble;
  let store: RoomStore;
  let room: LiveRoom;

  beforeEach(() => {
    vi.useFakeTimers({ now: BASE_TIME });
    server = new ServerDouble();
    store = new RoomStore();
    const transport = new WebSocketTransport(socketUrl('ws://localhost:8787/'), server.factory);
    const started = startLiveRoom({
      wsBase: 'ws://localhost:8787',
      roomId: id,
      token: TOKEN,
      store,
      transport,
    });
    if (started === null) throw new Error('room did not start');
    room = started;
  });

  afterEach(() => {
    room.stop();
    vi.useRealTimers();
  });

  it('dials the socket path and sends a join the shared decoder accepts', () => {
    expect(server.current.url).toBe('ws://localhost:8787/ws');
    server.current.open();
    expect(server.rejected).toEqual([]);
    expect(server.received).toEqual([
      expect.objectContaining({ t: 'join', token: TOKEN, auctionId: id, lastSeq: 0 }),
    ]);
  });

  it('applies the snapshot and price the server sends and estimates the clock offset', () => {
    server.current.open();
    server.current.push(stateMsg(1, openSnapshot(roster([5, 'Eve'])), BASE_TIME + 3_000));
    server.current.push(priceMsg(2, 5, 10_000));
    expect(store.getState().lastSeq).toBe(2);
    expect(selectPrice(store.getState())?.currentCents).toBe(10_000);
    expect(store.getClockOffsetMs()).toBeGreaterThan(2_000);
  });

  it('sends a bid with a message id that the matching accept settles', () => {
    server.current.open();
    server.current.push(stateMsg(1, openSnapshot(roster([5, 'Eve']))));
    const mid = room.bid(Cents(15_000), 'qr');
    const bid = server.received.find((m) => m.t === 'bid');
    expect(server.rejected).toEqual([]);
    expect(bid).toEqual(expect.objectContaining({ mid, amount: 15_000, source: 'qr' }));
    expect(room.pending.get(mid)?.status).toBe('pending');
    server.current.push({
      v: 1,
      t: 'bid_accepted',
      seq: 2,
      ts: EpochMs(BASE_TIME),
      mid,
      bidId: bidId(1),
      amount: Cents(15_000),
    });
    expect(room.pending.get(mid)?.status).toBe('accepted');
  });

  it('rejoins with the last applied seq after the socket drops', () => {
    server.current.open();
    server.current.push(stateMsg(1, openSnapshot(roster([5, 'Eve']))));
    server.current.push(priceMsg(2, 5, 10_000));
    server.current.drop();
    vi.advanceTimersByTime(1_000);
    expect(server.sockets).toHaveLength(2);
    server.current.open();
    const joins = server.received.filter((m) => m.t === 'join');
    expect(joins).toHaveLength(2);
    expect(joins[1]).toEqual(expect.objectContaining({ token: TOKEN, lastSeq: 2 }));
    expect(server.rejected).toEqual([]);
  });

  it('refuses a room id that is not an auction id', () => {
    expect(startLiveRoom({ wsBase: 'ws://x', roomId: 'room-7', token: TOKEN })).toBeNull();
  });
});
