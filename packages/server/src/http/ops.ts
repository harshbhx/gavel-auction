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

/** Settlement saga state of one lot, as the ops page lists it (R-QA-047). */
export interface OpsSagaView {
  auctionId: string;
  lotId: string;
  state: string;
  /** Count of saga transitions into each state, from the journal history. */
  transitions: Record<string, number>;
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

/** `POST /ops/auctions/<auctionId>/void-all` and `POST /ops/auctions/<auctionId>/release-review`. */
export const OPS_SETTLEMENT_PATH = /^\/ops\/auctions\/([^/]+)\/(void-all|release-review)$/;

/** The actor the audit rows of an operator release carry: the holder of the admin key. */
export const OPS_ACTOR = 'admin';

export interface OpsSettlementDeps {
  adminKey: string;
  /** True for an auction the room store knows. */
  exists: (auctionId: string) => Promise<boolean>;
  /** True once the auction has a settlement journal (the lot was hammered). */
  hasSettlement: (auctionId: string) => Promise<boolean>;
  /** R-PAY-112: voids every hold of the auction that is not captured. */
  voidAll: (
    auctionId: string,
    actor: string,
  ) => Promise<{ status: 'busy' } | { status: 'done'; holds: Record<string, string> }>;
  /** R9-M04, R11-O01: releases the fallback candidates' holds of a settlement in review. */
  releaseReviewHolds: (
    auctionId: string,
    actor: string,
  ) => Promise<'released' | 'busy' | 'not_in_review'>;
}

/**
 * The operator's money releases (R-PAY-112, R-PAY-063, R9-M04): admin key required, POST only.
 * `void-all` voids every hold of a hammered auction that is not captured (for example while
 * the kill switch keeps the capture waiting); `release-review` releases the holds a review
 * keeps for a fallback. Both are audited with the actor by the payments package; a run that
 * holds the settlement lease answers 409 `busy`.
 */
export function createOpsSettlementHandler(
  deps: OpsSettlementDeps,
): (req: IncomingMessage, res: ServerResponse, path: string) => Promise<void> {
  return async (req, res, path) => {
    const m = OPS_SETTLEMENT_PATH.exec(path);
    if (req.method !== 'POST') {
      res.setHeader('allow', 'POST');
      sendJson(res, 405, { error: 'method_not_allowed' });
      return;
    }
    if (!adminKeyMatches(req, deps.adminKey)) {
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }
    const rawId = m?.[1];
    const action = m?.[2];
    let auctionId: string;
    try {
      auctionId = decodeURIComponent(rawId ?? '');
    } catch {
      sendJson(res, 404, { error: 'not_found' });
      return;
    }
    if (auctionId === '' || !(await deps.exists(auctionId))) {
      sendJson(res, 404, { error: 'not_found' });
      return;
    }
    if (!(await deps.hasSettlement(auctionId))) {
      sendJson(res, 409, { error: 'no_settlement' });
      return;
    }
    if (action === 'void-all') {
      const out = await deps.voidAll(auctionId, OPS_ACTOR);
      if (out.status === 'busy') sendJson(res, 409, { error: 'busy' });
      else sendJson(res, 200, { status: 'done', holds: out.holds });
      return;
    }
    const released = await deps.releaseReviewHolds(auctionId, OPS_ACTOR);
    if (released === 'released') sendJson(res, 200, { status: 'released' });
    else sendJson(res, 409, { error: released });
  };
}
