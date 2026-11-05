import { GavelError } from '@gavel/shared';
import { z } from 'zod';
import { authorize } from '../auth/authorize';
import { consumeInvite } from '../auth/token';
import {
  auctionIdOf,
  authenticate,
  json,
  jtiStoreOf,
  mintToken,
  parseBody,
  verifyFor,
  type Ctx,
  type HttpApp,
  type HttpDeps,
} from './app';
import { linkFor, roomFor } from './auctions';

const MAX_INVITES = 50;

const InvitesBody = z
  .object({ count: z.number().int().min(1).max(MAX_INVITES).default(1) })
  .strict();

const JoinBody = z.object({ invite: z.string().min(1).max(2048) }).strict();

function wsUrlOf(deps: HttpDeps): string {
  return deps.wsUrl ?? `${deps.publicUrl.replace(/^http/, 'ws')}/ws`;
}

export function mountInvites(app: HttpApp): void {
  app.post('/api/auctions/:id/invites', async (c: Ctx) => {
    const auctionId = auctionIdOf(c);
    const who = await authenticate(c, auctionId, ['auctioneer', 'session', 'screen']);
    if (!authorize('invites_rotate', who.kind === 'auctioneer' ? 'auctioneer' : 'bidder').ok) {
      throw new GavelError('forbidden', 'only the auctioneer may mint invites');
    }
    const { count } = parseBody(InvitesBody, await c.body());
    await roomFor(c.deps, auctionId);
    const invites = [];
    for (let i = 0; i < count; i++) {
      const bidderId = c.deps.ids.mint<'BidderId'>();
      const m = await mintToken(c.deps, 'invite', auctionId, bidderId, bidderId);
      invites.push({
        bidderId,
        expiresAt: m.exp * 1000,
        link: linkFor(c.deps, auctionId, 'register', m.token),
      });
    }
    return json(201, { invites });
  });

  app.post('/api/auctions/:id/join', async (c: Ctx) => {
    const auctionId = auctionIdOf(c);
    const { invite } = parseBody(JoinBody, await c.body());
    await roomFor(c.deps, auctionId);
    // Verifying does not consume (#1232). The store's atomic consume is the single-use claim:
    // it runs only after the session exists, so a failed join leaves the invite usable, and of
    // two concurrent exchanges exactly one wins while the other gets `invite_used`.
    const claims = await verifyFor(c.deps, invite, auctionId, ['invite']);
    const bidderId = claims.bidderId ?? claims.sub;
    const session = await mintToken(c.deps, 'session', auctionId, bidderId, bidderId);
    const burned = await consumeInvite(claims, jtiStoreOf(c.deps));
    if (!burned.ok) throw new GavelError(burned.code, burned.reason);
    return json(200, {
      sessionToken: session.token,
      bidderId,
      wsUrl: wsUrlOf(c.deps),
    });
  });
}
