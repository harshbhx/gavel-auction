import { isUlid, type EpochMs, type Jti } from '@gavel/shared';
import { z } from 'zod';
import { TOKEN_TTL_S } from '../auth/token';
import {
  auctionIdOf,
  authenticate,
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
 * Auctioneer token routes (R-RT-084). Both routes put a jti on the store denylist, which HTTP
 * and WebSocket verification both consult, so a revoked token stops working everywhere.
 */
export function mountAuctioneerToken(app: HttpApp): void {
  app.post('/api/auctions/:id/auctioneer/rotate', async (c: Ctx) => {
    const auctionId = auctionIdOf(c);
    const who = await authenticate(c, auctionId, ['auctioneer']);
    await roomFor(c.deps, auctionId);
    const next = await mintToken(c.deps, 'auctioneer', auctionId, who.sub);
    await c.deps.store.denyJti(who.jti as Jti, (who.exp * 1000) as EpochMs);
    return json(200, { auctioneerLink: linkFor(c.deps, auctionId, 'console', next.token) });
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
