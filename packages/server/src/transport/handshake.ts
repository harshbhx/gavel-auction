import {
  decodeClientMsg,
  encodeMsg,
  type CancelTimer,
  type Clock,
  type JoinMsg,
} from '@gavel/shared';

/** R-RT-073 timings. */
export const JOIN_DEADLINE_MS = 5000;
export const PING_INTERVAL_MS = 20_000;
export const MAX_MISSED_PONGS = 2;
export const JOIN_TIMEOUT_CODE = 4001;
export const HEARTBEAT_LOST_CODE = 1001;

export interface HandshakeOptions {
  clock: Clock;
  /** Queue one encoded frame to the client. */
  send(text: string): void;
  close(code: number, reason: string): void;
  /** Send a transport-level ping. */
  ping(): void;
  /** Called once with the decoded join; it may reject by closing the connection. */
  onJoin(msg: JoinMsg): void | Promise<void>;
  /** Called for every frame after a successful join. */
  onFrame(raw: string): void | Promise<void>;
  joinDeadlineMs?: number;
  pingIntervalMs?: number;
}

/**
 * Per-connection gate: the first frame must be a valid `join` within the
 * deadline, frames before it get `not_joined`, and a ping loop drops a peer
 * that misses two pongs in a row (R-RT-073).
 */
export class Handshake {
  private joined = false;
  private done = false;
  private outstanding = 0;
  private cancelDeadline: CancelTimer | undefined;
  private cancelPing: CancelTimer | undefined;
  private readonly pingMs: number;

  constructor(private readonly opts: HandshakeOptions) {
    this.pingMs = opts.pingIntervalMs ?? PING_INTERVAL_MS;
    this.cancelDeadline = opts.clock.setTimer(
      opts.clock.now() + (opts.joinDeadlineMs ?? JOIN_DEADLINE_MS),
      () => {
        if (this.joined || this.done) return;
        this.stop();
        opts.close(JOIN_TIMEOUT_CODE, 'join_timeout');
      },
    );
    this.armPing();
  }

  get hasJoined(): boolean {
    return this.joined;
  }

  /** Feed one inbound text frame. */
  receive(raw: string): void | Promise<void> {
    if (this.done) return;
    if (this.joined) return this.opts.onFrame(raw);
    if (peekType(raw) !== 'join') {
      this.opts.send(errorFrame('not_joined'));
      return;
    }
    const decoded = decodeClientMsg(raw);
    if (!decoded.ok || decoded.value.t !== 'join') {
      this.opts.send(errorFrame('bad_message'));
      this.stop();
      this.opts.close(1008, 'bad_message');
      return;
    }
    this.joined = true;
    this.cancelDeadline?.();
    this.cancelDeadline = undefined;
    return this.opts.onJoin(decoded.value);
  }

  /** A pong arrived. */
  pong(): void {
    this.outstanding = 0;
  }

  /** Stop all timers; call when the socket closes. */
  stop(): void {
    this.done = true;
    this.cancelDeadline?.();
    this.cancelDeadline = undefined;
    this.cancelPing?.();
    this.cancelPing = undefined;
  }

  private armPing(): void {
    this.cancelPing = this.opts.clock.setTimer(this.opts.clock.now() + this.pingMs, () => {
      if (this.done) return;
      if (this.outstanding >= MAX_MISSED_PONGS) {
        this.stop();
        this.opts.close(HEARTBEAT_LOST_CODE, 'heartbeat_lost');
        return;
      }
      this.outstanding += 1;
      this.opts.ping();
      this.armPing();
    });
  }
}

function peekType(raw: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && 't' in parsed) {
      const t = (parsed as { t: unknown }).t;
      return typeof t === 'string' ? t : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function errorFrame(code: 'not_joined' | 'bad_message'): string {
  const out = encodeMsg({ v: 1, t: 'error', code, message: code });
  return out.ok ? out.value : '{}';
}
