import { GavelError } from '@gavel/shared';
import { z } from 'zod';
import { authorize } from '../auth/authorize';
import { consumeInvite } from '../auth/token';
import { RateLimiter } from '../limits/rate-limiter';
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

/** Fallback join limiter per host, used when the host passes no `joinLimit` (R-RT-120, R12-S11). */
const defaultLimiters = new WeakMap<HttpDeps, RateLimiter>();

function joinLimitOf(deps: HttpDeps, req: Request): ReturnType<NonNullable<HttpDeps['joinLimit']>> {
  if (deps.joinLimit) return deps.joinLimit(req);
  let limiter = defaultLimiters.get(deps);
  if (!limiter) {
    limiter = new RateLimiter(deps.clock);
    defaultLimiters.set(deps, limiter);
  }
  const hops = (req.headers.get('x-forwarded-for') ?? '').split(',');
  const source = hops[hops.length - 1]?.trim() || 'unknown';
  return limiter.checkJoin(source);
}

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
    const limited = joinLimitOf(c.deps, c.req);
    if (limited && !limited.ok) {
      return new Response(JSON.stringify({ error: 'rate_limited' }), {
        status: 429,
        headers: {
          'content-type': 'application/json',
          'retry-after': String(Math.max(1, Math.ceil(limited.retryAfterMs / 1000))),
        },
      });
    }
    const { invite } = parseBody(JoinBody, await c.body());
    await roomFor(c.deps, auctionId);
    const claims = await verifyFor(c.deps, invite, auctionId, ['invite']);
    const bidderId = claims.bidderId ?? claims.sub;
    const session = await mintToken(c.deps, 'session', auctionId, bidderId, bidderId);
    // Verification does not consume; burning the invite here makes a concurrent second exchange fail `invite_used`.
    const burned = await consumeInvite(claims, jtiStoreOf(c.deps));
    if (!burned.ok) throw new GavelError(burned.code, burned.reason);
    return json(200, {
      sessionToken: session.token,
      bidderId,
      wsUrl: wsUrlOf(c.deps),
    });
  });
}
