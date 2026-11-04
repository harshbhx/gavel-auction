import { parseServerMessage, type ClientMessage, type ServerMessage } from '../wire';
import type { Transport, TransportStatus, Unsubscribe } from './transport';

/** The slice of WebSocket this transport uses, so tests can supply a fake. */
export interface SocketLike {
  readonly readyState: number;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  send(data: string): void;
  close(): void;
}

export type SocketFactory = (url: string) => SocketLike;

const OPEN = 1;

const defaultFactory: SocketFactory = (url) => new WebSocket(url) as unknown as SocketLike;

/** Real transport over a WebSocket. Calling connect() again opens a fresh socket. */
export class WebSocketTransport implements Transport {
  private socket: SocketLike | null = null;
  private status: TransportStatus = 'closed';
  private readonly messageListeners = new Set<(m: ServerMessage) => void>();
  private readonly statusListeners = new Set<(s: TransportStatus) => void>();

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
      this.setStatus('closed');
      return;
    }
    this.socket = socket;
    this.setStatus('connecting');
    socket.onopen = () => {
      if (this.socket === socket) this.setStatus('open');
    };
    const lost = (): void => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.setStatus('closed');
    };
    socket.onclose = lost;
    socket.onerror = lost;
    socket.onmessage = (ev) => {
      if (this.socket !== socket || typeof ev.data !== 'string') return;
      let raw: unknown;
      try {
        raw = JSON.parse(ev.data);
      } catch {
        return;
      }
      const msg = parseServerMessage(raw);
      if (msg !== null) this.messageListeners.forEach((cb) => cb(msg));
    };
  }

  send(msg: ClientMessage): void {
    if (this.socket === null || this.socket.readyState !== OPEN) return;
    this.socket.send(JSON.stringify(msg));
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
