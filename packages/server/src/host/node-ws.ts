import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Clock } from '@gavel/shared';
import { WebSocketServer, type WebSocket } from 'ws';
import { BoundedConnection } from '../transport/connections';
import { Handshake, type HandshakeOptions } from '../transport/handshake';

/** R-RT-074: largest inbound frame; a bigger one closes the socket with 1009. */
export const MAX_PAYLOAD_BYTES = 16 * 1024;
export const WS_PATH = '/ws';
/** Close code for a frame that is not text (policy violation, as bad_message). */
export const BINARY_FRAME_CODE = 1008;

/** What the room side supplies for each accepted socket. */
export interface SocketHandlers {
  onJoin: HandshakeOptions['onJoin'];
  onFrame: HandshakeOptions['onFrame'];
  /** Called once when the socket is gone, whatever the cause. */
  onClosed?: (code: number, reason: string) => void;
}

export interface NodeWsHostOptions {
  /** The HTTP server whose `upgrade` event this host serves. */
  server: Server;
  clock: Clock;
  /** Exact `Origin` values that may open a socket. A request without `Origin` is refused. */
  allowedOrigins: readonly string[];
  /** Called for every accepted socket; `transport` is the bounded outbound side. */
  accept(transport: BoundedConnection): SocketHandlers;
  path?: string;
  maxPayload?: number;
}

export interface NodeWsHost {
  /**
   * Call from the HTTP request listener first. Returns true when it answered a plain
   * (non-upgrade) request on the socket path with 426.
   */
  handleRequest(req: IncomingMessage, res: ServerResponse): boolean;
  /** Close every open socket (1001) and stop accepting upgrades. */
  close(): Promise<void>;
}

export function createNodeWsHost(opts: NodeWsHostOptions): NodeWsHost {
  const path = opts.path ?? WS_PATH;
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: opts.maxPayload ?? MAX_PAYLOAD_BYTES,
  });
  const allowed = new Set(opts.allowedOrigins);

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    if (pathOf(req) !== path) {
      refuse(socket, 404, 'Not Found');
      return;
    }
    const origin = req.headers.origin;
    if (typeof origin !== 'string' || !allowed.has(origin)) {
      refuse(socket, 403, 'Forbidden');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => bind(ws, opts));
  };
  opts.server.on('upgrade', onUpgrade);

  return {
    handleRequest(req, res) {
      if (pathOf(req) !== path) return false;
      res.writeHead(426, {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Content-Type': 'text/plain',
      });
      res.end('Upgrade Required');
      return true;
    },
    close() {
      opts.server.off('upgrade', onUpgrade);
      for (const client of wss.clients) client.close(1001, 'going_away');
      return new Promise((resolve) => wss.close(() => resolve()));
    },
  };
}

function bind(ws: WebSocket, opts: NodeWsHostOptions): void {
  const state: { handlers?: SocketHandlers; handshake?: Handshake } = {};
  const transport = new BoundedConnection({
    clock: opts.clock,
    sink: {
      write: (text, done) => ws.send(text, (err) => done(err ?? undefined)),
      close: (code, reason) => ws.close(code, reason),
    },
    onClosed: (code, reason) => {
      state.handshake?.stop();
      state.handlers?.onClosed?.(code, reason);
    },
  });
  const handlers = opts.accept(transport);
  state.handlers = handlers;
  const handshake = new Handshake({
    clock: opts.clock,
    send: (text) => transport.send(text),
    close: (code, reason) => transport.close(code, reason),
    ping: () => ws.ping(),
    onJoin: handlers.onJoin,
    onFrame: handlers.onFrame,
  });
  state.handshake = handshake;
  ws.on('pong', () => handshake.pong());
  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      transport.close(BINARY_FRAME_CODE, 'bad_message');
      return;
    }
    const text = Array.isArray(data)
      ? Buffer.concat(data).toString('utf8')
      : Buffer.from(data as ArrayBuffer).toString('utf8');
    Promise.resolve(handshake.receive(text)).catch(() => {
      transport.close(1011, 'internal');
    });
  });
  ws.on('error', () => {
    // A protocol error (for example 1009) is followed by `close`; nothing else to do here.
  });
  ws.on('close', (code, reason) => {
    // Report the real close code once; a repeat from `transport.close` is ignored.
    transport.close(code, reason.toString('utf8'));
  });
}

function pathOf(req: IncomingMessage): string {
  const url = req.url ?? '';
  const cut = url.indexOf('?');
  return cut === -1 ? url : url.slice(0, cut);
}

function refuse(socket: Duplex, status: number, text: string): void {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}
