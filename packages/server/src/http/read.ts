import { GavelError, type AuctionId } from '@gavel/shared';
import { z } from 'zod';
import { authorize, redactForViewer } from '../auth/authorize';
import { auctionIdOf, authenticate, json, parseBody, type Ctx, type HttpApp } from './app';
import { auctionMeta, roomFor, snapshotFor, withMeta } from './auctions';
import { redactPersonal } from './export';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

/** Event types with a public form; a screen sees every other event as a bare seq. */
const SCREEN_EVENTS: ReadonlySet<string> = new Set([
  'auction_created',
  'bidder_registered',
  'bid_accepted',
  'control',
  'state_changed',
  'hammered',
]);

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
    const { frame, snapshot } = await snapshotFor(c.deps, room, role, who.sub, who.bidderId);
    const meta = await auctionMeta(c.deps, auctionId);
    return json(200, { ...frame, snapshot: withMeta(snapshot, meta) });
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
      // Rejections, holds, revokes and settlement carry per-bidder facts the live wire never
      // gives a screen: keep the seq so the log stays whole and nothing else.
      if (role === 'screen' && !SCREEN_EVENTS.has(e.type)) return { seq: e.seq };
      // Never more than the NDJSON export gives the same role: no ceilings, transcripts,
      // hold references or auctioneer subject.
      const personal = redactPersonal(role, e);
      return role === 'auctioneer' ? personal : redactForViewer(role, undefined, personal);
    });
    const last = events[events.length - 1];
    return json(200, { events: out, next: last === undefined ? after : last.seq });
  });
}
