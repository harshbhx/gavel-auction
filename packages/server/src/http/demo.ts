import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuctionConfig, AuctionId, BidderId, Cents, Ids } from '@gavel/shared';
import type { AuctionService } from '../runtime/auction-service';
import { adminKeyMatches } from './ops';

export const DEMO_RESET_PATH = '/api/demo/reset';
export const DEMO_SEED_PATH = '/api/demo/seed';
/** Creates one more seeded demo room without retiring the earlier ones. */
export const DEMO_ROOMS_PATH = '/api/demo/rooms';

/** Scripted bidders: fixed fake names, whole-cent ceilings. No personal data. */
export const DEMO_BIDDERS: ReadonlyArray<{ name: string; ceiling: number }> = [
  { name: 'Demo Bidder 1', ceiling: 50_000 },
  { name: 'Demo Bidder 2', ceiling: 80_000 },
  { name: 'Demo Bidder 3', ceiling: 120_000 },
];

export interface DemoDeps {
  /** True only when DEMO_MODE=1. When false both routes answer 404. */
  enabled: boolean;
  /** True under production config; demo routes then stay 404 even if enabled. */
  production: boolean;
  adminKey: string;
  ids: Ids;
  service: Pick<AuctionService, 'createAuction' | 'registerBidder'>;
  /** Scripted auction settings; a function lets the deadline be computed per room. */
  config: AuctionConfig | (() => AuctionConfig);
  auctioneerSub: string;
  /**
   * Returns an already-approved hold id for a scripted bidder. The host backs it
   * with the fake payments adapter; this module never talks to PayPal.
   */
  holdFor: (bidderId: BidderId, ceiling: Cents, auctionId: AuctionId) => Promise<string>;
  /** Drops the previous demo room, if the host keeps one. */
  retire?: (auctionId: AuctionId) => Promise<void>;
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

/** Handles `POST /api/demo/reset`, `/seed` and `/rooms` (R-RT-107). */
export function createDemoHandler(
  deps: DemoDeps,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  let current: AuctionId | undefined;

  const create = async (): Promise<AuctionId> => {
    const id = deps.ids.mint<'AuctionId'>();
    const config = typeof deps.config === 'function' ? deps.config() : deps.config;
    await deps.service.createAuction(id, config, deps.auctioneerSub);
    return id;
  };
  const fresh = async (): Promise<AuctionId> => {
    if (current !== undefined) await deps.retire?.(current);
    current = await create();
    return current;
  };

  return async (req, res) => {
    const path = (req.url ?? '').split('?')[0];
    const known = path === DEMO_RESET_PATH || path === DEMO_SEED_PATH || path === DEMO_ROOMS_PATH;
    if (!deps.enabled || deps.production || !known) {
      sendJson(res, 404, { error: 'not_found' });
      return;
    }
    if (req.method !== 'POST') {
      res.setHeader('allow', 'POST');
      sendJson(res, 405, { error: 'method_not_allowed' });
      return;
    }
    if (!adminKeyMatches(req, deps.adminKey)) {
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }
    try {
      const auctionId = path === DEMO_ROOMS_PATH ? await create() : await fresh();
      let bidders = 0;
      if (path !== DEMO_RESET_PATH) {
        for (const b of DEMO_BIDDERS) {
          const bidderId = deps.ids.mint<'BidderId'>();
          const holdId = await deps.holdFor(bidderId, b.ceiling as Cents, auctionId);
          await deps.service.registerBidder({ auctionId, bidderId, name: b.name, holdId });
          bidders += 1;
        }
      }
      sendJson(res, 200, { auctionId, bidders });
    } catch {
      sendJson(res, 500, { error: 'demo_failed' });
    }
  };
}
