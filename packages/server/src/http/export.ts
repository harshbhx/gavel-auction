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

/** A store that returned a page with a hole, or stopped before the last event it reported. */
export class ExportGapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportGapError';
  }
}

type ExportStore = Pick<RoomStore, 'readEvents'> & Partial<Pick<RoomStore, 'lastSeq'>>;

/**
 * The whole log as NDJSON lines, one JSON object per line, in seq order. Paging follows
 * the seq values actually returned: a page that does not start at the next seq, or a log
 * that ends before the last seq read at the start, fails the stream instead of ending it
 * quietly (R4-E06). The HTTP handler turns that failure into a cut connection, so a short
 * file never looks complete.
 */
export async function* exportLines(
  store: ExportStore,
  auctionId: AuctionId,
  role: AuthRole,
): AsyncGenerator<string> {
  const end = store.lastSeq === undefined ? undefined : await store.lastSeq(auctionId);
  let next = 1;
  while (end === undefined || next <= end) {
    const page = await store.readEvents(auctionId, next, PAGE);
    if (page.length === 0) break;
    for (const event of page) {
      if (event.seq !== next) {
        throw new ExportGapError(`expected seq ${next} but the store returned ${event.seq}`);
      }
      yield `${JSON.stringify(redactPersonal(role, event))}\n`;
      next = event.seq + 1;
    }
  }
  if (end !== undefined && next - 1 < end) {
    throw new ExportGapError(`export stopped at seq ${next - 1} but the log reaches ${end}`);
  }
}

function sendJson(res: ServerResponse, status: number, error: string): void {
  const text = JSON.stringify({ error });
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': text.length });
  res.end(text);
}

/** Resolves on 'drain'; rejects when the client goes away first, so the handler never hangs. */
function drained(res: ServerResponse): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (err?: Error): void => {
      res.off('drain', onDrain);
      res.off('close', onClose);
      res.off('error', onError);
      if (err === undefined) resolve();
      else reject(err);
    };
    const onDrain = (): void => done();
    const onClose = (): void => done(new Error('client closed the connection'));
    const onError = (err: Error): void => done(err);
    res.on('drain', onDrain);
    res.on('close', onClose);
    res.on('error', onError);
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
    let first: IteratorResult<string>;
    try {
      first = await lines.next();
    } catch {
      sendJson(res, 500, 'export_failed');
      return;
    }
    if (first.done === true) {
      sendJson(res, 404, 'not_found');
      return;
    }
    res.writeHead(200, {
      'content-type': 'application/x-ndjson',
      'cache-control': 'no-store',
    });
    try {
      let item: IteratorResult<string> = first;
      while (item.done !== true) {
        if (res.destroyed) throw new Error('client closed the connection');
        if (!res.write(item.value)) await drained(res);
        item = await lines.next();
      }
      res.end();
    } catch {
      // The header is out: cut the connection so the client sees an incomplete transfer,
      // and stop reading the store.
      await lines.return(undefined).catch(() => undefined);
      res.destroy();
    }
  };
}
