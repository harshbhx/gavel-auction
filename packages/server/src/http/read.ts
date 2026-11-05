import { GavelError, type AuctionId } from '@gavel/shared';
import { z } from 'zod';
import { authorize, redactEventForExport, redactForViewer } from '../auth/authorize';
import { auctionIdOf, authenticate, json, parseBody, type Ctx, type HttpApp } from './app';
import { roomFor, snapshotFor } from './auctions';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

const Query = z
  .object({
    after: z.coerce.number().int().min(0).default(0),
    limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  })
  .strict();

/** Read routes (R-RT-104): the data is filtered by the caller's role exactly as on the wire. */
export function mountRead(app: HttpApp): void {
  app.get('/api/auctions/:id/snapshot', async (c: Ctx) => {
    const auctionId = auctionIdOf(c);
    const who = await authenticate(c, auctionId, ['auctioneer', 'session', 'screen']);
    const role =
      who.kind === 'session' ? 'bidder' : who.kind === 'screen' ? 'screen' : 'auctioneer';
    if (!authorize('snapshot', role).ok) throw new GavelError('forbidden', 'not allowed');
    const room = await roomFor(c.deps, auctionId);
    const { frame } = await snapshotFor(c.deps, room, role, who.sub, who.bidderId);
    return json(200, frame);
  });

  app.get('/api/auctions/:id/events', async (c: Ctx) => {
    const auctionId = auctionIdOf(c);
    const who = await authenticate(c, auctionId, ['auctioneer', 'screen']);
    const role = who.kind === 'screen' ? 'screen' : 'auctioneer';
    const raw = Object.fromEntries(c.url.searchParams);
    const { after, limit } = parseBody(Query, raw);
    await roomFor(c.deps, auctionId);
    const events = await c.deps.store.readEvents(auctionId as AuctionId, after + 1, limit);
    const out = events.map((e) => {
      const exported = redactEventForExport(role, e);
      return role === 'auctioneer' ? exported : redactForViewer(role, undefined, exported);
    });
    const last = events[events.length - 1];
    return json(200, { events: out, next: last === undefined ? after : last.seq });
  });
}
