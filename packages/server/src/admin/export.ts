import type { IncomingMessage, ServerResponse } from 'node:http';
import { headOf, type LedgerEntry, type LedgerStore, type Ulid } from '@gavel/engine';
import { adminKeyMatches } from '../http/ops';

/**
 * `GET /admin/export?auction=<id>` (`auctionId` is accepted as an alias) (R-QA-046): the ledger as NDJSON, one entry per line,
 * then a last line carrying the hash chain head. This is the private engine ledger: it carries
 * every bidder's ceiling, hold reference and bid transcript, so the output must never reach a
 * public place (see docs/RUNBOOK-BACKUP.md). `GET /admin/export?list=1` returns every auction id
 * the store holds, finished ones included, as `{ auctions: [...] }`. A verifier checks the chain
 * and compares the head line.
 *
 * Payment and room state (HRD-79): `kind=payments&auction=<id>` returns the settlement journal and
 * hold records of one auction as JSON, `kind=payments-global` the processed webhook event ids and
 * the kill switch state, and `kind=roomlog&auction=<id>` the room event log as NDJSON with a last
 * `{ end: { count, lastSeq } }` line. These are what a restore needs to match a PayPal hold to its
 * settle or void step. Every payload is passed through `redactSecrets` and webhook bodies are
 * dropped, so no PayPal client secret, token or bidder password can leave through them.
 */

/** Payment state reads for the backup. Values are plain JSON records. */
export interface PaymentExportSource {
  journal(auctionId: string): Promise<unknown>;
  holds(auctionId: string): Promise<readonly unknown[]>;
  /** Every webhook event the store has seen, processed or not. */
  webhooks(): Promise<readonly WebhookExportRow[]>;
  kill(): Promise<unknown>;
}

export interface WebhookExportRow {
  id: string;
  eventType: string;
  receivedAtMs: number;
  result?: string;
  parkedUntilMs?: number;
  /** Dropped from the export; only its size is kept. */
  body?: string;
}

export interface ExportDeps {
  adminKey: string;
  ledger: LedgerStore;
  payments?: PaymentExportSource;
  /** Room events from `fromSeq`, at most `limit`. */
  roomLog?: (auctionId: string, fromSeq: number, limit: number) => Promise<readonly unknown[]>;
  /** Every auction id in the store, loaded or not. */
  listAuctions?: () => Promise<readonly string[]>;
}

export interface ExportHeadLine {
  head: { seq: number; hash: string } | null;
}

const AUCTION_ID = /^[0-9A-Za-z_-]{1,64}$/;
const SECRET_KEY =
  /secret|password|passcode|token|authorization|api[-_]?key|private[-_]?key|cookie/i;
const ROOM_LOG_PAGE = 1000;

/** Copy of a JSON value with the value of every secret-looking key replaced. */
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? '[redacted]' : redactSecrets(v);
    }
    return out;
  }
  return value;
}

/** A webhook row without its body: the id and outcome are what a replay check needs. */
export function webhookRow(w: WebhookExportRow): Record<string, unknown> {
  const { body, ...rest } = w;
  return { ...rest, bodyBytes: body === undefined ? 0 : Buffer.byteLength(body) };
}

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

function handleState(deps: ExportDeps, kind: string, auctionId: string, res: ServerResponse): void {
  const fail = (): void => sendJson(res, 500, { error: 'export_failed' });
  if (kind === 'payments-global') {
    if (deps.payments === undefined) return sendJson(res, 501, { error: 'payments_unsupported' });
    const src = deps.payments;
    Promise.all([src.webhooks(), src.kill()]).then(([hooks, kill]) => {
      const webhooks = [...hooks].sort((a, b) => (a.id < b.id ? -1 : 1)).map(webhookRow);
      sendJson(res, 200, redactSecrets({ webhooks, kill }));
    }, fail);
    return;
  }
  if (kind !== 'payments' && kind !== 'roomlog') {
    return sendJson(res, 400, { error: 'bad_kind' });
  }
  if (!AUCTION_ID.test(auctionId)) return sendJson(res, 400, { error: 'bad_auction_id' });
  if (kind === 'payments') {
    if (deps.payments === undefined) return sendJson(res, 501, { error: 'payments_unsupported' });
    const src = deps.payments;
    Promise.all([src.journal(auctionId), src.holds(auctionId)]).then(([journal, holds]) => {
      sendJson(res, 200, redactSecrets({ auctionId, journal, holds }));
    }, fail);
    return;
  }
  const readLog = deps.roomLog;
  if (readLog === undefined) return sendJson(res, 501, { error: 'roomlog_unsupported' });
  void (async () => {
    const events: unknown[] = [];
    let from = 1;
    for (;;) {
      const page = await readLog(auctionId, from, ROOM_LOG_PAGE);
      events.push(...page);
      if (page.length < ROOM_LOG_PAGE) break;
      from += page.length;
    }
    const lines = [
      ...events.map((e) => redactSecrets(e)),
      { end: { count: events.length, lastSeq: events.length } },
    ];
    const body = lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
    res.writeHead(200, {
      'content-type': 'application/x-ndjson',
      'content-length': Buffer.byteLength(body),
      'cache-control': 'no-store',
    });
    res.end(body);
  })().catch(fail);
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
    if (url.searchParams.get('list') === '1') {
      if (deps.listAuctions === undefined) {
        sendJson(res, 501, { error: 'list_unsupported' });
        return;
      }
      deps.listAuctions().then(
        (ids) => sendJson(res, 200, { auctions: [...ids].sort() }),
        () => sendJson(res, 500, { error: 'list_failed' }),
      );
      return;
    }
    const kind = url.searchParams.get('kind');
    if (kind !== null) {
      handleState(deps, kind, url.searchParams.get('auction') ?? '', res);
      return;
    }
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
