import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  ChainError,
  publicExport,
  verifyChain,
  verifyPublicExport,
  type LedgerEntry,
  type LedgerStore,
  type Ulid,
} from '@gavel/engine';
import {
  REPLAY_BUNDLE_VERSION,
  REPLAY_EXPORT_VERSION,
  type ReplayBundle,
  type ReplayEvent,
} from '@gavel/shared';
import { adminKeyMatches } from '../http/ops';

/**
 * `GET /admin/replay-bundle?auctionId=<id>`: the replay bundle built from the real ledger.
 * The private chain is verified first, then redacted to export v4; the bundle carries the
 * public chain head so a client can run `verifyPublicExport` and compare it.
 */

export interface ReplayBundleDeps {
  adminKey: string;
  ledger: LedgerStore;
  now: () => number;
}

const AUCTION_ID = /^[0-9A-Za-z_-]{1,64}$/;

/** Builds the bundle; throws ChainError when the ledger does not verify. */
export function buildReplayBundle(
  auctionId: string,
  entries: readonly LedgerEntry[],
  generatedAt: number,
): ReplayBundle {
  const v = verifyChain(entries);
  if (!v.ok) throw new ChainError(v.firstBadIndex, v.reason);
  const events = publicExport(entries) as ReplayEvent[];
  const pub = verifyPublicExport(events as Parameters<typeof verifyPublicExport>[0]);
  if (!pub.ok) throw new ChainError(pub.firstBadIndex, 'bad_hash');
  return {
    version: REPLAY_BUNDLE_VERSION,
    exportVersion: REPLAY_EXPORT_VERSION,
    auctionId,
    generatedAt,
    count: events.length,
    headHash: events.length === 0 ? null : pub.headHash,
    closed: pub.closed,
    events,
  };
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

export function createReplayBundleHandler(
  deps: ReplayBundleDeps,
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
    const auctionId = url.searchParams.get('auctionId') ?? '';
    if (!AUCTION_ID.test(auctionId)) {
      sendJson(res, 400, { error: 'bad_auction_id' });
      return;
    }
    deps.ledger.read(auctionId as Ulid, 1).then(
      (entries) => {
        if (entries.length === 0) {
          sendJson(res, 404, { error: 'not_found' });
          return;
        }
        try {
          sendJson(res, 200, buildReplayBundle(auctionId, entries, deps.now()));
        } catch (err) {
          sendJson(res, err instanceof ChainError ? 409 : 500, {
            error: err instanceof ChainError ? 'ledger_unverified' : 'export_failed',
          });
        }
      },
      () => sendJson(res, 500, { error: 'export_failed' }),
    );
  };
}
