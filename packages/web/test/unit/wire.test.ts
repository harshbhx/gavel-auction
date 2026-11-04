// @vitest-environment node
import { Cents, EpochMs, decodeClientMsg, serverSchemas } from '@gavel/shared';
import { readdirSync } from 'node:fs';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { ConnectionManager } from '../../src/net/connection';
import type { Transport, TransportStatus } from '../../src/net/transport';
import { WebSocketTransport, type SocketLike } from '../../src/net/wsTransport';
import { RoomStore } from '../../src/store/roomStore';
import { PendingBids } from '../../src/store/localEvents';
import { selectMyStatus, selectPrice } from '../../src/store/selectors';
import {
  BASE_TIME,
  auctionId,
  bidId,
  bidderId,
  msgId,
  openSnapshot,
  priceMsg,
  roster,
  stateMsg,
} from '../../src/testing/builders';
import {
  decodeServerMsg,
  encodeMsg,
  parseServerMessage,
  type ClientMessage,
  type ServerMessage,
} from '../../src/wire';

const ts = EpochMs(BASE_TIME);

/** One valid frame for every type the server can send, built with the shared types. */
const fixtures: Record<keyof typeof serverSchemas, ServerMessage> = {
  registered: {
    v: 1,
    t: 'registered',
    seq: 2,
    ts,
    bidderId: bidderId(5),
    paddle: 5,
    ceiling: Cents(20_000),
    role: 'bidder',
  },
  bid_accepted: {
    v: 1,
    t: 'bid_accepted',
    seq: 3,
    ts,
    mid: msgId(1),
    bidId: bidId(1),
    amount: Cents(5_000),
  },
  bid_rejected: {
    v: 1,
    t: 'bid_rejected',
    seq: 4,
    ts,
    mid: msgId(2),
    reason: 'over_ceiling',
    retryable: false,
  },
  price: priceMsg(5, 5, 10_000),
  state: stateMsg(1, openSnapshot(roster([5, 'Eve']))),
  confirm_request: {
    v: 1,
    t: 'confirm_request',
    seq: 6,
    ts,
    confirmId: 'c-1',
    amount: Cents(15_000),
    expiresAt: EpochMs(BASE_TIME + 8_000),
  },
  hammer: {
    v: 1,
    t: 'hammer',
    seq: 7,
    ts,
    winnerId: bidderId(5),
    price: Cents(10_000),
    ranking: [{ bidderId: bidderId(5), amount: Cents(10_000) }],
  },
  settlement_update: {
    v: 1,
    t: 'settlement_update',
    seq: 8,
    ts,
    rev: 1,
    auctionState: 'CAPTURED',
    amountCaptured: Cents(10_000),
  },
  audit_event: {
    v: 1,
    t: 'audit_event',
    seq: 9,
    ts,
    audit: {
      bidId: bidId(1),
      bidderId: bidderId(5),
      source: 'qr',
      outcome: 'accepted',
      serverTs: ts,
      seq: 9,
    },
  },
  error: { v: 1, t: 'error', code: 'rate_limited', message: 'slow down', retryAfterMs: 500 },
};

describe('wire seam (R-WEB-007)', () => {
  it('has no wire shapes of its own: src/wire holds only the re-export seam', () => {
    expect(readdirSync(new URL('../../src/wire', import.meta.url))).toEqual(['index.ts']);
  });

  it('has a fixture for every server message type', () => {
    expect(Object.keys(fixtures).sort()).toEqual(Object.keys(serverSchemas).sort());
    expectTypeOf<ServerMessage['t']>().toEqualTypeOf<keyof typeof serverSchemas>();
  });

  it.each(Object.entries(fixtures))('%s passes the shared decoder and the web guard', (_t, msg) => {
    const encoded = encodeMsg(msg);
    if (!encoded.ok) throw new Error('fixture does not encode');
    const decoded = decodeServerMsg(encoded.value);
    expect(decoded.ok && decoded.value).toEqual(msg);
    expect(parseServerMessage(JSON.parse(encoded.value))).toEqual(msg);
  });

  it('rejects the old local mirror shapes', () => {
    const oldPrice = { t: 'price', seq: 1, roomId: 'r', serverTime: 1, currentCents: 1 };
    expect(parseServerMessage(oldPrice)).toBeNull();
    const oldState = { t: 'state', seq: 1, roomId: 'r', serverTime: 1, room: {}, bidders: [] };
    expect(parseServerMessage(oldState)).toBeNull();
  });

  it('rejects unknown types, extra fields, wrong version and non-integer money', () => {
    expect(parseServerMessage(null)).toBeNull();
    expect(parseServerMessage('price')).toBeNull();
    expect(parseServerMessage({ ...fixtures.price, t: 'nope' })).toBeNull();
    expect(parseServerMessage({ ...fixtures.price, extra: 1 })).toBeNull();
    expect(parseServerMessage({ ...fixtures.price, v: 2 })).toBeNull();
    expect(parseServerMessage({ ...fixtures.price, price: 10.5 })).toBeNull();
    expect(parseServerMessage({ ...fixtures.price, seq: 0 })).toBeNull();
    expect(parseServerMessage({ ...fixtures.price, leaderId: 'not-a-ulid' })).toBeNull();
  });

  it('does not accept client-only message types from the server', () => {
    const join = { v: 1, t: 'join', token: 't', auctionId: auctionId() };
    expect(parseServerMessage(join)).toBeNull();
  });
});

class FakeSocket implements SocketLike {
  readyState = 1;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  sent: string[] = [];
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {}
}

describe('WEB-RT-01: web and server speak the same frames', () => {
  it('a live room renders from frames encoded with the shared codec', () => {
    const socket = new FakeSocket();
    const transport = new WebSocketTransport('ws://x/ws', () => socket);
    const store = new RoomStore(auctionId());
    transport.onMessage((msg) => store.dispatch({ kind: 'wire', msg }));
    transport.connect();
    socket.onopen?.();

    const frames: ServerMessage[] = [
      stateMsg(1, {
        ...openSnapshot(roster([5, 'Eve'], [9, 'Sam'])),
        you: { bidderId: bidderId(5), ceiling: Cents(20_000) },
      }),
      priceMsg(2, 5, 10_000),
    ];
    for (const frame of frames) {
      const encoded = encodeMsg(frame);
      if (!encoded.ok) throw new Error('fixture does not encode');
      socket.onmessage?.({ data: encoded.value });
    }

    expect(transport.problemCount).toBe(0);
    expect(selectPrice(store.getState())).toMatchObject({
      currentCents: 10_000,
      leaderPaddle: 5,
      nextMinCents: 15_000,
    });
    expect(selectMyStatus(store.getState())).toBe('leading');
  });

  it('the join and bid the client sends pass the server decoder', () => {
    const sent: ClientMessage[] = [];
    const transport: Transport = {
      connect: () => {},
      send: (m) => sent.push(m),
      onMessage: () => () => {},
      onStatus: (cb: (s: TransportStatus) => void) => {
        cb('open');
        return () => {};
      },
      close: () => {},
    };
    const manager = new ConnectionManager({
      transport,
      auctionId: auctionId(),
      getLastSeq: () => 12,
      getToken: () => 'tok',
      onMessage: () => {},
    });
    manager.start();
    const bids = new PendingBids({
      send: (m) => sent.push(m),
      setTimer: () => null,
      clearTimer: () => {},
      newId: () => msgId(1),
    });
    bids.submitBid(Cents(5_000), 'qr');
    bids.dispose();
    manager.stop();

    expect(sent.map((m) => m.t)).toEqual(['join', 'bid']);
    for (const msg of sent) {
      const result = decodeClientMsg(JSON.stringify(msg));
      expect(result.ok).toBe(true);
    }
  });
});
