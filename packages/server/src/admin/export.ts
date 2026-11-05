import type { IncomingMessage, ServerResponse } from 'node:http';
import { headOf, type LedgerEntry, type LedgerStore, type Ulid } from '@gavel/engine';
import { adminKeyMatches } from '../http/ops';

/**
 * `GET /admin/export?auction=<id>` (`auctionId` is accepted as an alias) (R-QA-046): the ledger as NDJSON, one entry per line,
 * then a last line carrying the hash chain head. Ledger entries hold ids and cents only, so
 * nothing personal is written; a verifier checks the chain and compares the head line.
 */

export interface ExportDeps {
  adminKey: string;
  ledger: LedgerStore;
}

export interface ExportHeadLine {
  head: { seq: number; hash: string } | null;
}

const AUCTION_ID = /^[0-9A-Za-z_-]{1,64}$/;

/** Render entries plus the head line as NDJSON text. */
export function toNdjson(entries: readonly LedgerEntry[]): string {
  const head: ExportHeadLine = { head: headOf(entries) };
  return [...entries, head].map((line) => JSON.stringify(line)).join('\n') + '\n';
}

/** Parse an export back into entries and head; null when it is not well formed. */
export function parseNdjson(
  text: string,
): { entries: LedgerEntry[]; head: ExportHeadLine['head'] } | null {
  const lines = text.split('\n').filter((l) => l.length > 0);
  const last = lines.pop();
  if (last === undefined) return null;
  try {
    const tail = JSON.parse(last) as ExportHeadLine;
    if (typeof tail !== 'object' || tail === null || !('head' in tail)) return null;
    const entries = lines.map((l) => JSON.parse(l) as LedgerEntry);
    return { entries, head: tail.head };
  } catch {
    return null;
  }
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

export function createExportHandler(
  deps: ExportDeps,
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
    const url = new URL(req.url ?? '/', 'http://local');
    const auctionId = url.searchParams.get('auction') ?? url.searchParams.get('auctionId') ?? '';
    if (!AUCTION_ID.test(auctionId)) {
      sendJson(res, 400, { error: 'bad_auction_id' });
      return;
    }
    deps.ledger.read(auctionId as Ulid, 1).then(
      (entries) => {
        if (entries.length === 0) {
          // A mistyped id must not look like an empty ledger to a backup job.
          sendJson(res, 404, { error: 'not_found' });
          return;
        }
        const body = toNdjson(entries);
        res.writeHead(200, {
          'content-type': 'application/x-ndjson',
          'content-length': Buffer.byteLength(body),
          'cache-control': 'no-store',
        });
        res.end(body);
      },
      () => sendJson(res, 500, { error: 'export_failed' }),
    );
  };
}
