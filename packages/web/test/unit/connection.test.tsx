import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Button } from '../../src/design/primitives/Button';
import {
  backoffDelay,
  ConnectionManager,
  setActiveConnection,
  useConnection,
  type JoinWithToken,
} from '../../src/net/connection';
import type { Transport, TransportStatus } from '../../src/net/transport';
import { WebSocketTransport, type SocketLike } from '../../src/net/wsTransport';
import type { ClientMessage, ServerMessage } from '../../src/wire';

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

function setup(random = 0.5, seq = 0, token: string | null = 'tok') {
  const clock = new Clock();
  const transport = new FakeTransport();
  const received: ServerMessage[] = [];
  const manager = new ConnectionManager({
    transport,
    roomId: 'r1',
    getResumeFromSeq: () => seq,
    getSessionToken: () => token,
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
    transport.set('closed');
    const last = clock.delays[clock.delays.length - 1];
    expect(last).toBe(500);
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
    const joins = transport.sent.filter((m): m is JoinWithToken => m.t === 'join');
    expect(joins).toHaveLength(2);
    expect(joins[1]).toEqual({
      t: 'join',
      roomId: 'r1',
      resumeFromSeq: 42,
      sessionToken: 'secret-token',
    });
  });

  it('omits the token for a watcher', () => {
    const { transport, manager } = setup(0.5, 0, null);
    transport.failConnect = false;
    manager.start();
    expect(transport.sent[0]).toEqual({ t: 'join', roomId: 'r1', resumeFromSeq: 0 });
  });

  it('forwards server messages and stops cleanly', () => {
    const { clock, transport, manager, received } = setup();
    transport.failConnect = false;
    manager.start();
    const msg: ServerMessage = {
      t: 'error',
      seq: 1,
      roomId: 'r1',
      serverTime: 1,
      code: 'x',
      message: 'm',
    };
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
    transport.send({ t: 'join', roomId: 'r1' });
    expect(socket.sent).toEqual([]);
    socket.readyState = 1;
    transport.send({ t: 'join', roomId: 'r1' });
    expect(socket.sent).toEqual([JSON.stringify({ t: 'join', roomId: 'r1' })]);
  });

  it('delivers valid messages and drops malformed ones', () => {
    const { sockets, transport, messages } = make();
    transport.connect();
    const socket = sockets[0];
    if (socket === undefined) throw new Error('no socket');
    const good = { t: 'error', seq: 1, roomId: 'r1', serverTime: 1, code: 'x', message: 'm' };
    socket.onmessage?.({ data: JSON.stringify(good) });
    socket.onmessage?.({ data: 'not json' });
    socket.onmessage?.({ data: JSON.stringify({ t: 'price' }) });
    expect(messages).toEqual([good]);
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
