import { decodeServerMsg, encodeMsg, type ClientMessage, type ServerMessage } from '../wire';
import type { Transport, TransportStatus, Unsubscribe } from './transport';

/** The slice of WebSocket this transport uses, so tests can supply a fake. */
export interface SocketLike {
  readonly readyState: number;
  onopen: (() => void) | null;
  onclose: ((ev?: { code?: number }) => void) | null;
  onerror: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  send(data: string): void;
  close(): void;
}

export type SocketFactory = (url: string) => SocketLike;

/** Why a frame was not delivered, for diagnostics. Nothing is dropped without being counted. */
export interface FrameProblem {
  kind: 'undecodable' | 'unencodable' | 'binary';
  /** Shared decoder code, such as bad_message or unsupported_version. */
  code: string;
  /** Running total of problems on this transport. */
  count: number;
}

const OPEN = 1;

const defaultFactory: SocketFactory = (url) => new WebSocket(url) as unknown as SocketLike;

/** Real transport over a WebSocket. Calling connect() again opens a fresh socket. */
export class WebSocketTransport implements Transport {
  private socket: SocketLike | null = null;
  private status: TransportStatus = 'closed';
  private readonly messageListeners = new Set<(m: ServerMessage) => void>();
  private readonly statusListeners = new Set<(s: TransportStatus) => void>();
  private readonly problemListeners = new Set<(p: FrameProblem) => void>();
  private problems = 0;
  /** Close code of the socket that ended last, or null when it had none (or is still open). */
  lastCloseCode: number | null = null;

  constructor(
    private readonly url: string,
    private readonly factory: SocketFactory = defaultFactory,
  ) {}

  connect(): void {
    if (this.socket !== null) this.detach(this.socket);
    let socket: SocketLike;
    try {
      socket = this.factory(this.url);
    } catch {
      // A failed attempt is an event of its own: the connection manager schedules the next try
      // from it, even though the status was already closed.
      this.socket = null;
      this.status = 'closed';
      this.statusListeners.forEach((cb) => cb('closed'));
      return;
    }
    this.socket = socket;
    this.lastCloseCode = null;
    this.setStatus('connecting');
    socket.onopen = () => {
      if (this.socket === socket) this.setStatus('open');
    };
    const lost = (ev?: { code?: number }): void => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.lastCloseCode = typeof ev?.code === 'number' ? ev.code : null;
      this.setStatus('closed');
    };
    socket.onclose = (ev) => lost(ev);
    socket.onerror = () => lost();
    socket.onmessage = (ev) => {
      if (this.socket !== socket) return;
      if (typeof ev.data !== 'string') {
        this.problem('binary', 'bad_message');
        return;
      }
      const res = decodeServerMsg(ev.data);
      if (!res.ok) {
        this.problem('undecodable', res.code);
        return;
      }
      this.messageListeners.forEach((cb) => cb(res.value));
    };
  }

  /** True when the frame went to an open socket; false when it was dropped (closed or unencodable). */
  send(msg: ClientMessage): boolean {
    if (this.socket === null || this.socket.readyState !== OPEN) return false;
    const encoded = encodeMsg(msg);
    if (!encoded.ok) {
      this.problem('unencodable', encoded.error.code);
      return false;
    }
    this.socket.send(encoded.value);
    return true;
  }

  /** Total frames that could not be decoded or encoded since this transport was created. */
  get problemCount(): number {
    return this.problems;
  }

  /** Called for every frame that was rejected, so drift from the shared schemas is visible. */
  onProblem(cb: (p: FrameProblem) => void): Unsubscribe {
    this.problemListeners.add(cb);
    return () => {
      this.problemListeners.delete(cb);
    };
  }

  private problem(kind: FrameProblem['kind'], code: string): void {
    this.problems += 1;
    const problem: FrameProblem = { kind, code, count: this.problems };
    this.problemListeners.forEach((cb) => cb(problem));
  }

  onMessage(cb: (m: ServerMessage) => void): Unsubscribe {
    this.messageListeners.add(cb);
    return () => {
      this.messageListeners.delete(cb);
    };
  }

  onStatus(cb: (s: TransportStatus) => void): Unsubscribe {
    this.statusListeners.add(cb);
    return () => {
      this.statusListeners.delete(cb);
    };
  }

  close(): void {
    if (this.socket !== null) {
      const socket = this.socket;
      this.socket = null;
      this.detach(socket);
    }
    if (this.status !== 'closed') this.setStatus('closed');
  }

  private detach(socket: SocketLike): void {
    socket.onopen = null;
    socket.onclose = null;
    socket.onerror = null;
    socket.onmessage = null;
    try {
      socket.close();
    } catch {
      // Already closed.
    }
    if (this.socket === socket) this.socket = null;
  }

  private setStatus(next: TransportStatus): void {
    if (this.status === next) return;
    this.status = next;
    this.statusListeners.forEach((cb) => cb(next));
  }
}
