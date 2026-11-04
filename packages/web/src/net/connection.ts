import { useSyncExternalStore } from 'react';
import type { AuctionId } from '@gavel/shared';
import { PROTOCOL_VERSION, type JoinMsg, type ServerMessage } from '../wire';
import type { Transport, TransportStatus } from './transport';

/** Delays between reconnect attempts. The last value repeats (R-WEB-023). */
export const BACKOFF_MS: readonly number[] = [500, 1000, 2000, 4000, 8000];
export const JITTER = 0.2;
/** Time disconnected before the offline banner shows (R-WEB-024). */
export const OFFLINE_AFTER_MS = 2000;

export interface ConnectionSnapshot {
  status: TransportStatus;
  offline: boolean;
}

/** A connection that stays open this long counts as stable, and the backoff starts over. */
export const STABLE_AFTER_MS = 5000;

export interface ConnectionDeps {
  transport: Transport;
  auctionId: AuctionId;
  /** Highest seq applied so far, read at every (re)join. */
  getLastSeq(): number;
  /** The session token: a bidder token, or the screen token a watcher was given. */
  getToken(): string;
  onMessage(msg: ServerMessage): void;
  /** Defaults to Math.random. Returns a value in [0, 1). */
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/** Delay before reconnect attempt number `attempt` (0 based), with plus or minus 20 percent jitter. */
export function backoffDelay(attempt: number, random: number): number {
  const base = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] ?? 8000;
  return Math.round(base * (1 + (random * 2 - 1) * JITTER));
}

/**
 * Keeps a transport connected: reconnects forever with jittered backoff, re-sends `join` with the
 * resume point and session token on every open, and derives `offline` once the connection has
 * been down for 2000 ms. The backoff starts over only after the server accepted the join (the
 * first snapshot) or the socket stayed open for STABLE_AFTER_MS, so a server that accepts the
 * socket and then drops it is not hammered.
 */
export class ConnectionManager {
  private snapshot: ConnectionSnapshot = { status: 'closed', offline: false };
  private readonly listeners = new Set<() => void>();
  private attempt = 0;
  private reconnectTimer: unknown = null;
  private offlineTimer: unknown = null;
  private stableTimer: unknown = null;
  private running = false;
  private unsubscribers: Array<() => void> = [];
  private readonly random: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(private readonly deps: ConnectionDeps) {
    this.random = deps.random ?? Math.random;
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as number));
  }

  getSnapshot = (): ConnectionSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  start(): void {
    if (this.running) return;
    this.running = true;
    const { transport } = this.deps;
    this.unsubscribers = [
      transport.onStatus((s) => this.handleStatus(s)),
      transport.onMessage((m) => {
        if (m.t === 'state') this.attempt = 0;
        this.deps.onMessage(m);
      }),
    ];
    transport.connect();
  }

  stop(): void {
    this.running = false;
    this.clearReconnect();
    this.clearOffline();
    this.clearStable();
    this.unsubscribers.forEach((u) => u());
    this.unsubscribers = [];
    this.deps.transport.close();
    this.update({ status: 'closed', offline: false });
  }

  private handleStatus(status: TransportStatus): void {
    if (!this.running) return;
    if (status === 'open') {
      this.clearReconnect();
      this.clearOffline();
      this.clearStable();
      this.stableTimer = this.setTimer(() => {
        this.stableTimer = null;
        this.attempt = 0;
      }, STABLE_AFTER_MS);
      this.update({ status, offline: false });
      this.sendJoin();
      return;
    }
    if (status === 'connecting') {
      this.update({ ...this.snapshot, status });
      return;
    }
    this.clearStable();
    this.update({ ...this.snapshot, status });
    if (this.offlineTimer === null && !this.snapshot.offline) {
      this.offlineTimer = this.setTimer(() => {
        this.offlineTimer = null;
        if (this.running) this.update({ ...this.snapshot, offline: true });
      }, OFFLINE_AFTER_MS);
    }
    this.scheduleReconnect();
  }

  /** Sends a join with the current token and resume point. Used on open and to resync. */
  sendJoin(): void {
    const join: JoinMsg = {
      v: PROTOCOL_VERSION,
      t: 'join',
      token: this.deps.getToken(),
      auctionId: this.deps.auctionId,
      lastSeq: this.deps.getLastSeq(),
    };
    this.deps.transport.send(join);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    const delay = backoffDelay(this.attempt, this.random());
    this.attempt += 1;
    this.reconnectTimer = this.setTimer(() => {
      this.reconnectTimer = null;
      if (this.running) this.deps.transport.connect();
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) this.clearTimer(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private clearStable(): void {
    if (this.stableTimer !== null) this.clearTimer(this.stableTimer);
    this.stableTimer = null;
  }

  private clearOffline(): void {
    if (this.offlineTimer !== null) this.clearTimer(this.offlineTimer);
    this.offlineTimer = null;
  }

  private update(next: ConnectionSnapshot): void {
    if (next.status === this.snapshot.status && next.offline === this.snapshot.offline) return;
    this.snapshot = next;
    this.listeners.forEach((l) => l());
  }
}

const IDLE: ConnectionSnapshot = { status: 'closed', offline: false };
let active: ConnectionManager | null = null;
const holderListeners = new Set<() => void>();

/** Chooses the manager that `useConnection` reports on. Pass null to detach. */
export function setActiveConnection(manager: ConnectionManager | null): void {
  active = manager;
  holderListeners.forEach((l) => l());
}

function subscribeActive(listener: () => void): () => void {
  let off = active?.subscribe(listener);
  const onHolderChange = (): void => {
    off?.();
    off = active?.subscribe(listener);
    listener();
  };
  holderListeners.add(onHolderChange);
  return () => {
    holderListeners.delete(onHolderChange);
    off?.();
  };
}

function getActiveSnapshot(): ConnectionSnapshot {
  return active?.getSnapshot() ?? IDLE;
}

export function useConnection(): ConnectionSnapshot {
  return useSyncExternalStore(subscribeActive, getActiveSnapshot);
}
