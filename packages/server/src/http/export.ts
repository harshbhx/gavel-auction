import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuctionId, RoomEvent, RoomStore } from '@gavel/shared';
import { authorize, redactEventForExport, type AuthRole } from '../auth/authorize';

const PAGE = 500;
const EXPORT_PATH = /^\/api\/auctions\/([^/]+)\/export\/?$/;

export interface ExportDeps {
  store: Pick<RoomStore, 'readEvents'>;
  /**
   * Resolves the caller's role for this auction from the request, or undefined
   * when the credentials are missing or invalid. Token checks live in the host.
   */
  authenticate: (req: IncomingMessage, auctionId: string) => Promise<AuthRole | undefined>;
}

/**
 * Personal fields removed for everyone but the operator key: bidder display
 * names, hold references, the auctioneer subject and voice transcripts. Ceilings
 * are handled by `redactEventForExport`.
 */
export function redactPersonal(role: AuthRole, event: RoomEvent): unknown {
  const base = redactEventForExport(role, event);
  if (role === 'admin') return base;
  const copy: Record<string, unknown> = { ...base };
  delete copy.name;
  delete copy.holdRef;
  delete copy.auctioneerSub;
  const audit = copy.audit;
  if (typeof audit === 'object' && audit !== null) {
    const a: Record<string, unknown> = { ...audit };
    delete a.transcript;
    copy.audit = a;
  }
  return copy;
}

/** The whole log as NDJSON lines, one JSON object per line, in seq order. */
export async function* exportLines(
  store: Pick<RoomStore, 'readEvents'>,
  auctionId: AuctionId,
  role: AuthRole,
): AsyncGenerator<string> {
  let from = 1;
  for (;;) {
    const page = await store.readEvents(auctionId, from, PAGE);
    for (const event of page) yield `${JSON.stringify(redactPersonal(role, event))}\n`;
    if (page.length < PAGE) return;
    from += PAGE;
  }
}

function sendJson(res: ServerResponse, status: number, error: string): void {
  const text = JSON.stringify({ error });
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': text.length });
  res.end(text);
}

function drained(res: ServerResponse): Promise<void> {
  return new Promise((resolve) => {
    res.once('drain', resolve);
  });
}

/** `GET /api/auctions/:id/export`: streams the event log as NDJSON (R-RT-108). */
export function createExportHandler(
  deps: ExportDeps,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    const match = EXPORT_PATH.exec((req.url ?? '').split('?')[0] ?? '');
    const id = match?.[1];
    if (id === undefined) {
      sendJson(res, 404, 'not_found');
      return;
    }
    if (req.method !== 'GET') {
      res.setHeader('allow', 'GET');
      sendJson(res, 405, 'method_not_allowed');
      return;
    }
    const role = await deps.authenticate(req, id);
    if (role === undefined) {
      sendJson(res, 401, 'unauthorized');
      return;
    }
    if (!authorize('export', role).ok) {
      sendJson(res, 403, 'forbidden');
      return;
    }
    const lines = exportLines(deps.store, id as AuctionId, role);
    const first = await lines.next();
    if (first.done === true) {
      sendJson(res, 404, 'not_found');
      return;
    }
    res.writeHead(200, {
      'content-type': 'application/x-ndjson',
      'cache-control': 'no-store',
    });
    let item: IteratorResult<string> = first;
    while (item.done !== true) {
      if (!res.write(item.value)) await drained(res);
      item = await lines.next();
    }
    res.end();
  };
}
