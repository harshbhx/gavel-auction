import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Button } from '../../src/design/primitives/Button';
import {
  backoffDelay,
  ConnectionManager,
  STABLE_AFTER_MS,
  setActiveConnection,
  useConnection,
} from '../../src/net/connection';
import type { Transport, TransportStatus } from '../../src/net/transport';
import { WebSocketTransport, type SocketLike } from '../../src/net/wsTransport';
import { auctionId, priceMsg, stateMsg } from '../../src/testing/builders';
import {
  PROTOCOL_VERSION,
  encodeMsg,
  type ClientMessage,
  type ServerMessage,
} from '../../src/wire';

/** Virtual clock: timers fire in order as `advance` moves time forward. */
class Clock {
  now = 0;
  private nextId = 1;
  private readonly timers = new Map<number, { at: number; fn: () => void }>();
  readonly delays: number[] = [];

  setTimer = (fn: () => void, ms: number): number => {
    const id = this.nextId++;
    this.delays.push(ms);
    this.timers.set(id, { at: this.now + ms, fn });
    return id;
  };

  clearTimer = (handle: unknown): void => {
    this.timers.delete(handle as number);
  };

  advance(ms: number): void {
    const target = this.now + ms;
    for (;;) {
      const due = [...this.timers.entries()]
        .filter(([, t]) => t.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (due === undefined) break;
      this.timers.delete(due[0]);
      this.now = due[1].at;
      due[1].fn();
    }
    this.now = target;
  }
}

class FakeTransport implements Transport {
  sent: ClientMessage[] = [];
  connects = 0;
  /** When true, connect() fails at once: connecting then closed. */
  failConnect = true;
  private status: TransportStatus = 'closed';
  private readonly statusCbs = new Set<(s: TransportStatus) => void>();
  private readonly msgCbs = new Set<(m: ServerMessage) => void>();

  connect(): void {
    this.connects += 1;
    this.set('connecting');
    this.set(this.failConnect ? 'closed' : 'open');
  }
  send(msg: ClientMessage): void {
    this.sent.push(msg);
  }
  onMessage(cb: (m: ServerMessage) => void): () => void {
    this.msgCbs.add(cb);
    return () => this.msgCbs.delete(cb);
  }
  onStatus(cb: (s: TransportStatus) => void): () => void {
    this.statusCbs.add(cb);
    return () => this.statusCbs.delete(cb);
  }
  close(): void {
    this.set('closed');
  }
  set(s: TransportStatus): void {
    this.status = s;
    this.statusCbs.forEach((cb) => cb(s));
  }
  get current(): TransportStatus {
    return this.status;
  }
}

function setup(random = 0.5, seq = 0, token = 'tok') {
  const clock = new Clock();
  const transport = new FakeTransport();
  const received: ServerMessage[] = [];
  const manager = new ConnectionManager({
    transport,
    auctionId: auctionId(),
    getLastSeq: () => seq,
    getToken: () => token,
    onMessage: (m) => received.push(m),
    random: () => random,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  return { clock, transport, manager, received };
}

afterEach(() => setActiveConnection(null));

describe('backoffDelay', () => {
  it('doubles from 500 to 8000 and then stays at 8000', () => {
    const delays = [0, 1, 2, 3, 4, 5, 6].map((n) => backoffDelay(n, 0.5));
    expect(delays).toEqual([500, 1000, 2000, 4000, 8000, 8000, 8000]);
  });

  it('stays within plus or minus 20 percent', () => {
    expect(backoffDelay(0, 0)).toBe(400);
    expect(backoffDelay(0, 0.999999)).toBe(600);
    expect(backoffDelay(4, 0)).toBe(6400);
    expect(backoffDelay(9, 0.999999)).toBe(9600);
  });
});

describe('ConnectionManager reconnect (T-WEB-013)', () => {
  it('retries with 500, 1000, 2000, 4000, 8000, 8000 and resets after success', () => {
    const { clock, transport, manager } = setup();
    manager.start();
    expect(transport.connects).toBe(1);
    // The first recorded delay is the 2000 ms offline timer; reconnect delays follow it.

    for (const wait of [500, 1000, 2000, 4000, 8000, 8000]) {
      const before = transport.connects;
      clock.advance(wait - 1);
      expect(transport.connects).toBe(before);
      clock.advance(1);
      expect(transport.connects).toBe(before + 1);
    }
    expect(clock.delays.slice(1, 7)).toEqual([500, 1000, 2000, 4000, 8000, 8000]);

    transport.failConnect = false;
    clock.advance(8000);
    expect(transport.current).toBe('open');
    clock.advance(STABLE_AFTER_MS);
    transport.set('closed');
    const last = clock.delays[clock.delays.length - 1];
    expect(last).toBe(500);
  });

  it('keeps backing off when the server accepts the socket and drops it at once (WEB-RT-08)', () => {
    const { clock, transport, manager } = setup();
    transport.failConnect = false;
    manager.start();
    const waits: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      transport.set('closed');
      waits.push(clock.delays[clock.delays.length - 1] ?? -1);
      clock.advance(waits[i] ?? 0);
    }
    expect(waits).toEqual([500, 1000, 2000, 4000, 8000, 8000]);
  });

  it('starts the backoff over once the server answered the join with a snapshot', () => {
    const { clock, transport, manager } = setup();
    transport.failConnect = false;
    manager.start();
    transport.set('closed');
    clock.advance(500);
    transport.set('closed');
    clock.advance(1000);
    const received = (transport as unknown as { msgCbs: Set<(m: ServerMessage) => void> }).msgCbs;
    received.forEach((cb) => cb(stateMsg(1)));
    const before = clock.delays.length;
    transport.set('closed');
    expect(clock.delays.slice(before).filter((d) => d !== 2000)).toEqual([500]);
  });

  it('keeps retrying when the socket factory throws (WEB-RT-07)', () => {
    const clock = new Clock();
    let attempts = 0;
    const transport = new WebSocketTransport('ws://x/ws', () => {
      attempts += 1;
      throw new Error('blocked');
    });
    const manager = new ConnectionManager({
      transport,
      auctionId: auctionId(),
      getLastSeq: () => 0,
      getToken: () => 'tok',
      onMessage: () => {},
      random: () => 0.5,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    manager.start();
    expect(attempts).toBe(1);
    clock.advance(500);
    expect(attempts).toBe(2);
    clock.advance(1000);
    expect(attempts).toBe(3);
    clock.advance(2000);
    expect(attempts).toBe(4);
  });

  it('applies jitter to the delay', () => {
    const low = setup(0);
    low.manager.start();
    expect(low.clock.delays).toContain(400);
    const high = setup(0.999999);
    high.manager.start();
    expect(high.clock.delays).toContain(600);
  });

  it('re-sends join with resumeFromSeq and the session token on every open', () => {
    const { clock, transport, manager } = setup(0.5, 42, 'secret-token');
    transport.failConnect = false;
    manager.start();
    transport.set('closed');
    clock.advance(500);
    const joins = transport.sent.filter((m) => m.t === 'join');
    expect(joins).toHaveLength(2);
    expect(joins[1]).toEqual({
      v: PROTOCOL_VERSION,
      t: 'join',
      token: 'secret-token',
      auctionId: auctionId(),
      lastSeq: 42,
    });
  });

  it('sendJoin repeats the join with the token, for a resync (WEB-RT-04)', () => {
    const { transport, manager } = setup(0.5, 7, 'tok-9');
    transport.failConnect = false;
    manager.start();
    manager.sendJoin();
    expect(transport.sent).toHaveLength(2);
    expect(transport.sent[1]).toMatchObject({ t: 'join', token: 'tok-9', lastSeq: 7 });
  });

  it('forwards server messages and stops cleanly', () => {
    const { clock, transport, manager, received } = setup();
    transport.failConnect = false;
    manager.start();
    const msg: ServerMessage = priceMsg(1, 1, 1_000);
    (transport as unknown as { msgCbs: Set<(m: ServerMessage) => void> }).msgCbs.forEach((cb) =>
      cb(msg),
    );
    expect(received).toEqual([msg]);
    manager.stop();
    const connects = transport.connects;
    clock.advance(60_000);
    expect(transport.connects).toBe(connects);
    expect(manager.getSnapshot()).toEqual({ status: 'closed', offline: false });
  });
});

describe('offline flag (T-WEB-014)', () => {
  it('is false at 1900 ms and true at 2100 ms of disconnect', () => {
    const { clock, transport, manager } = setup();
    transport.failConnect = false;
    manager.start();
    expect(manager.getSnapshot()).toEqual({ status: 'open', offline: false });
    transport.failConnect = true;
    transport.set('closed');
    clock.advance(1900);
    expect(manager.getSnapshot().offline).toBe(false);
    clock.advance(200);
    expect(manager.getSnapshot().offline).toBe(true);
  });

  it('clears when the connection comes back', () => {
    const { clock, transport, manager } = setup();
    manager.start();
    clock.advance(2100);
    expect(manager.getSnapshot().offline).toBe(true);
    transport.failConnect = false;
    clock.advance(8000);
    expect(manager.getSnapshot()).toEqual({ status: 'open', offline: false });
  });

  it('disables the bid button with aria-disabled once offline', () => {
    const { clock, transport, manager } = setup();
    transport.failConnect = false;
    manager.start();
    setActiveConnection(manager);
    function Bid() {
      const { offline } = useConnection();
      return (
        <>
          <Button size="bid" disabled={offline}>
            Bid
          </Button>
          {offline && <p role="status">offline banner</p>}
        </>
      );
    }
    render(<Bid />);
    transport.failConnect = true;
    act(() => {
      transport.set('closed');
      clock.advance(1900);
    });
    expect(screen.queryByText('offline banner')).toBeNull();
    expect(screen.getByRole('button').hasAttribute('aria-disabled')).toBe(false);
    act(() => clock.advance(200));
    expect(screen.getByText('offline banner')).toBeTruthy();
    expect(screen.getByRole('button').getAttribute('aria-disabled')).toBe('true');
  });
});

class FakeSocket implements SocketLike {
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  sent: string[] = [];
  closed = false;
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
  }
}

describe('WebSocketTransport', () => {
  function make() {
    const sockets: FakeSocket[] = [];
    const transport = new WebSocketTransport('ws://x/ws', () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    });
    const statuses: TransportStatus[] = [];
    const messages: ServerMessage[] = [];
    transport.onStatus((s) => statuses.push(s));
    transport.onMessage((m) => messages.push(m));
    return { sockets, transport, statuses, messages };
  }

  it('reports connecting, open and closed', () => {
    const { sockets, transport, statuses } = make();
    transport.connect();
    const socket = sockets[0];
    if (socket === undefined) throw new Error('no socket');
    socket.readyState = 1;
    socket.onopen?.();
    socket.onclose?.();
    expect(statuses).toEqual(['connecting', 'open', 'closed']);
  });

  it('sends JSON only while open', () => {
    const { sockets, transport } = make();
    transport.connect();
    const socket = sockets[0];
    if (socket === undefined) throw new Error('no socket');
    const join: ClientMessage = {
      v: PROTOCOL_VERSION,
      t: 'join',
      token: 'tok',
      auctionId: auctionId(),
      lastSeq: 0,
    };
    transport.send(join);
    expect(socket.sent).toEqual([]);
    socket.readyState = 1;
    transport.send(join);
    expect(socket.sent).toEqual([JSON.stringify(join)]);
  });

  it('does not send a message the shared schema rejects', () => {
    const { sockets, transport } = make();
    transport.connect();
    const socket = sockets[0];
    if (socket === undefined) throw new Error('no socket');
    socket.readyState = 1;
    const bad = { v: 1, t: 'join', roomId: 'r1' } as unknown as ClientMessage;
    transport.send(bad);
    expect(socket.sent).toEqual([]);
    expect(transport.problemCount).toBe(1);
  });

  it('delivers frames encoded by the shared codec', () => {
    const { sockets, transport, messages } = make();
    transport.connect();
    const socket = sockets[0];
    if (socket === undefined) throw new Error('no socket');
    const frames: ServerMessage[] = [stateMsg(1), priceMsg(2, 7, 10_000)];
    for (const frame of frames) {
      const encoded = encodeMsg(frame);
      if (!encoded.ok) throw new Error('fixture does not encode');
      socket.onmessage?.({ data: encoded.value });
    }
    expect(messages.map((m) => m.t)).toEqual(['state', 'price']);
    expect(messages[1]).toMatchObject({ price: 10_000, leaderPaddle: 7 });
    expect(transport.problemCount).toBe(0);
  });

  it('delivers an error frame that has no seq (WEB-RT-09)', () => {
    const { sockets, transport, messages } = make();
    transport.connect();
    const socket = sockets[0];
    if (socket === undefined) throw new Error('no socket');
    socket.onmessage?.({
      data: JSON.stringify({ v: 1, t: 'error', code: 'unauthorized', message: 'bad token' }),
    });
    expect(messages).toEqual([{ v: 1, t: 'error', code: 'unauthorized', message: 'bad token' }]);
  });

  it('counts and reports frames it cannot decode instead of dropping them silently (WEB-RT-09)', () => {
    const { sockets, transport, messages } = make();
    const problems: Array<{ kind: string; code: string; count: number }> = [];
    transport.onProblem((p) => problems.push(p));
    transport.connect();
    const socket = sockets[0];
    if (socket === undefined) throw new Error('no socket');
    socket.onmessage?.({ data: 'not json' });
    socket.onmessage?.({ data: JSON.stringify({ t: 'price' }) });
    socket.onmessage?.({ data: new ArrayBuffer(4) });
    // The old mirror shape: no v, room and time fields.
    socket.onmessage?.({
      data: JSON.stringify({ t: 'price', seq: 1, roomId: 'r', serverTime: 1 }),
    });
    expect(messages).toEqual([]);
    expect(transport.problemCount).toBe(4);
    expect(problems.map((p) => [p.kind, p.count])).toEqual([
      ['undecodable', 1],
      ['undecodable', 2],
      ['binary', 3],
      ['undecodable', 4],
    ]);
  });

  it('opens a fresh socket on every connect and ignores the old one', () => {
    const { sockets, transport, statuses } = make();
    transport.connect();
    transport.connect();
    expect(sockets).toHaveLength(2);
    expect(sockets[0]?.closed).toBe(true);
    sockets[0]?.onclose?.();
    expect(statuses).toEqual(['connecting']);
  });

  it('close() closes the socket and reports closed', () => {
    const { sockets, transport, statuses } = make();
    transport.connect();
    transport.close();
    expect(sockets[0]?.closed).toBe(true);
    expect(statuses).toEqual(['connecting', 'closed']);
  });
});
