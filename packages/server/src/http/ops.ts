import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** Header that carries the operator key (R-RT-137). */
export const ADMIN_KEY_HEADER = 'x-admin-key';

/** What the ops view needs to know about one loaded room. */
export interface OpsRoomView {
  auctionId: string;
  seq: number;
  status: string;
  connections: number;
  mailboxDepth: number;
}

export interface OpsRoomsDeps {
  adminKey: string;
  /** Snapshot of the rooms the host has loaded; read on every request. */
  rooms: () => Iterable<OpsRoomView>;
}

/** Constant-time check of the operator key on a request. */
export function adminKeyMatches(req: IncomingMessage, adminKey: string): boolean {
  const raw = req.headers[ADMIN_KEY_HEADER];
  const given = Array.isArray(raw) ? raw[0] : raw;
  if (adminKey.length === 0 || typeof given !== 'string') return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(adminKey).digest();
  return timingSafeEqual(a, b);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  });
  res.end(text);
}

/** `GET /ops/rooms`: admin key required; lists loaded rooms (R-RT-137). */
export function createOpsRoomsHandler(
  deps: OpsRoomsDeps,
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    if (req.method !== 'GET') {
      res.setHeader('allow', 'GET');
      sendJson(res, 405, { error: 'method_not_allowed' });
      return;
    }
    if (!adminKeyMatches(req, deps.adminKey)) {
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }
    const rooms = [...deps.rooms()].map((r) => ({
      auctionId: r.auctionId,
      seq: r.seq,
      status: r.status,
      connections: r.connections,
      mailboxDepth: r.mailboxDepth,
    }));
    sendJson(res, 200, { rooms });
  };
}
