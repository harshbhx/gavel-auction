import { describe, expect, it } from 'vitest';
import {
  ConnectionManager,
  SILENCE_MS,
  SUPERSEDED_CLOSE_CODE,
  WATCHDOG_CHECK_MS,
  type WakeSource,
} from '../../src/net/connection';
import type { Transport, TransportStatus } from '../../src/net/transport';
import { auctionId, priceMsg } from '../../src/testing/builders';
import type { ClientMessage, ServerMessage } from '../../src/wire';

/** Virtual clock: timers fire in order as `advance` moves time forward. */
class Clock {
  now = 1_000;
  private nextId = 1;
  private readonly timers = new Map<number, { at: number; fn: () => void }>();
  setTimer = (fn: () => void, ms: number): number => {
    const id = this.nextId++;
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
  closes = 0;
  lastCloseCode: number | null = null;
  /** When false, connect() only reports connecting and the test opens the socket itself. */
  autoOpen = true;
  private readonly statusCbs = new Set<(s: TransportStatus) => void>();
  private readonly msgCbs = new Set<(m: ServerMessage) => void>();
  connect(): void {
    this.connects += 1;
    this.lastCloseCode = null;
    this.set('connecting');
    if (this.autoOpen) this.set('open');
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
    this.closes += 1;
    this.set('closed');
  }
  set(s: TransportStatus): void {
    this.statusCbs.forEach((cb) => cb(s));
  }
  emit(m: ServerMessage): void {
    this.msgCbs.forEach((cb) => cb(m));
  }
}

function setup() {
  const clock = new Clock();
  const transport = new FakeTransport();
  const wakeCbs = new Set<() => void>();
  const wake: WakeSource = {
    subscribe: (cb) => {
      wakeCbs.add(cb);
      return () => wakeCbs.delete(cb);
    },
  };
  const manager = new ConnectionManager({
    transport,
    auctionId: auctionId(),
    getLastSeq: () => 3,
    getToken: () => 'tok',
    onMessage: () => {},
    random: () => 0.5,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    now: () => clock.now,
    wake,
  });
  return { clock, transport, manager, fireWake: () => wakeCbs.forEach((cb) => cb()) };
}

describe('reconnect() for a resync (#2226)', () => {
  it('opens a fresh socket with one first join and never a second join on the old one', () => {
    const { transport, manager } = setup();
    manager.start();
    expect(transport.sent).toHaveLength(1);
    manager.reconnect();
    expect(transport.connects).toBe(2);
    // One join per socket: the old socket got exactly one, the new socket gets exactly one.
    expect(transport.sent.map((m) => m.t)).toEqual(['join', 'join']);
    expect(manager.getSnapshot().offline).toBe(false);
  });
});

describe('wake events and the silence watchdog (#2229)', () => {
  it('reconnects at once when the page wakes while a reconnect timer is pending', () => {
    const { transport, manager, fireWake } = setup();
    manager.start();
    transport.set('closed');
    expect(transport.connects).toBe(1);
    fireWake();
    expect(transport.connects).toBe(2);
    expect(manager.getSnapshot().status).toBe('open');
  });

  it('does nothing on wake while the connection is open and recently heard from', () => {
    const { transport, manager, fireWake } = setup();
    manager.start();
    fireWake();
    expect(transport.connects).toBe(1);
    expect(transport.closes).toBe(0);
  });

  it('drops an open connection that stayed silent past the limit, then reconnects', () => {
    const { clock, transport, manager } = setup();
    manager.start();
    clock.advance(SILENCE_MS - WATCHDOG_CHECK_MS);
    expect(transport.closes).toBe(0);
    clock.advance(WATCHDOG_CHECK_MS);
    expect(transport.closes).toBe(1);
    clock.advance(1_000);
    expect(transport.connects).toBe(2);
  });

  it('a frame resets the silence clock', () => {
    const { clock, transport, manager } = setup();
    manager.start();
    clock.advance(SILENCE_MS - 1_000);
    transport.emit(priceMsg(1, 1, 1_000));
    clock.advance(SILENCE_MS - 1_000);
    expect(transport.closes).toBe(0);
  });

  it('a wake after a long sleep drops the stale socket at once', () => {
    const { clock, transport, manager, fireWake } = setup();
    manager.start();
    // The device slept: its timers never ran, but its clock moved on.
    clock.now += SILENCE_MS + 5_000;
    fireWake();
    expect(transport.closes).toBe(1);
  });
});

describe('a superseded connection (#2231)', () => {
  it('stops instead of reconnecting and reports superseded', () => {
    const { clock, transport, manager } = setup();
    manager.start();
    transport.lastCloseCode = SUPERSEDED_CLOSE_CODE;
    transport.set('closed');
    clock.advance(60_000);
    expect(transport.connects).toBe(1);
    expect(manager.getSnapshot()).toMatchObject({ status: 'closed', superseded: true });
  });

  it('still reconnects after an ordinary close', () => {
    const { clock, transport, manager } = setup();
    manager.start();
    transport.lastCloseCode = 1006;
    transport.set('closed');
    clock.advance(1_000);
    expect(transport.connects).toBe(2);
    expect(manager.getSnapshot().superseded).toBeUndefined();
  });
});
