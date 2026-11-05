import { GavelError, isUlid, type AuctionId, type EpochMs, type Jti } from '@gavel/shared';
import { z } from 'zod';
import { raiseAuctioneerFloor } from '../auth/auctioneer-floor';
import { TOKEN_TTL_S } from '../auth/token';
import {
  auctionIdOf,
  json,
  mintToken,
  parseBody,
  requireAdmin,
  type Ctx,
  type HttpApp,
} from './app';
import { linkFor, roomFor } from './auctions';

const RevokeBody = z.object({ jti: z.string().refine(isUlid, 'invalid id') }).strict();

/**
 * Auctioneer token routes (R-RT-084). All three need the operator key: a leaked auctioneer
 * link must not be able to mint a successor and lock the real auctioneer out. Each one raises
 * the per-auction floor, so every auctioneer token issued earlier stops working (HTTP and the
 * socket join both check it), whatever its jti.
 */
export function mountAuctioneerToken(app: HttpApp): void {
  /** Operator key: kill every earlier auctioneer token and issue a fresh link. */
  app.post('/api/auctions/:id/auctioneer/rotate', async (c: Ctx) => {
    const auctionId = auctionIdOf(c);
    requireAdmin(c);
    await roomFor(c.deps, auctionId);
    const created = (await c.deps.store.readEvents(auctionId as AuctionId, 1, 1))[0];
    if (created?.type !== 'auction_created') throw new GavelError('not_found', 'no such auction');
    const nowSec = Math.floor(c.deps.clock.now() / 1000);
    const floor = await raiseAuctioneerFloor(c.deps.store, auctionId, nowSec + 1);
    const next = await mintToken(
      c.deps,
      'auctioneer',
      auctionId,
      created.auctioneerSub,
      undefined,
      floor,
    );
    return json(200, { auctioneerLink: linkFor(c.deps, auctionId, 'console', next.token) });
  });

  /** Operator key: kill every auctioneer token of the auction without issuing a new one. */
  app.post('/api/auctions/:id/auctioneer/revoke-all', async (c: Ctx) => {
    const auctionId = auctionIdOf(c);
    requireAdmin(c);
    await roomFor(c.deps, auctionId);
    const nowSec = Math.floor(c.deps.clock.now() / 1000);
    await raiseAuctioneerFloor(c.deps.store, auctionId, nowSec + 1);
    return json(200, { revoked: true });
  });

  /** Operator key plus the jti to kill, for a lost or leaked link. */
  app.post('/api/auctions/:id/auctioneer/revoke', async (c: Ctx) => {
    const auctionId = auctionIdOf(c);
    requireAdmin(c);
    const { jti } = parseBody(RevokeBody, await c.body());
    await roomFor(c.deps, auctionId);
    const until = c.deps.clock.now() + TOKEN_TTL_S.auctioneer * 1000;
    await c.deps.store.denyJti(jti as Jti, until as EpochMs);
    return json(200, { revoked: true });
  });
}
