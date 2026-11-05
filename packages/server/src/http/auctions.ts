import {
  AuctionConfigSchema,
  GavelError,
  isErrorCode,
  type AuctionId,
  type BidderId,
  type ConnId,
  type RoomSnapshot,
} from '@gavel/shared';
import { z } from 'zod';
import { MemoryTransport } from '../room/memory-transport';
import type { Connection, Room } from '../room/room';
import {
  auctionIdOf,
  json,
  mintToken,
  parseBody,
  requireAdmin,
  type Ctx,
  type HttpApp,
  type HttpDeps,
} from './app';

const CreateBody = z
  .object({
    title: z.string().trim().min(1).max(120).default('Untitled auction'),
    config: AuctionConfigSchema,
  })
  .strict();

const titleKey = (auctionId: string): string => `http:title:${auctionId}`;

/** Link the host hands out for a role. The token rides in the fragment so it never reaches a log. */
export function linkFor(deps: HttpDeps, auctionId: string, page: string, token: string): string {
  return `${deps.publicUrl}/r/${auctionId}/${page}#token=${token}`;
}

/** The room for an id that exists; an unknown id is `not_found`, not an empty room. */
export async function roomFor(deps: HttpDeps, auctionId: string): Promise<Room> {
  if ((await deps.store.lastSeq(auctionId as AuctionId)) === 0) {
    throw new GavelError('not_found', 'no such auction');
  }
  return deps.service.room(auctionId as AuctionId);
}

/** Attach a throwaway connection, run `fn`, detach, and return every frame the room sent to it. */
export async function withConnection(
  deps: HttpDeps,
  room: Room,
  role: Connection['role'],
  sub: string,
  fn?: (conn: Connection) => Promise<void>,
  bidderId?: string,
): Promise<Array<Record<string, unknown>>> {
  const transport = new MemoryTransport();
  const conn: Connection = {
    id: deps.ids.mint<'ConnId'>() as ConnId,
    role,
    sub,
    transport,
    internal: true,
    ...(bidderId !== undefined ? { bidderId: bidderId as BidderId } : {}),
  };
  await room.attach(conn);
  const refused = transport.messages().find((f) => f.t === 'error');
  if (refused !== undefined) {
    // The room turned the connection away: run nothing and report why.
    room.detach(conn.id);
    const code = refused.code;
    throw new GavelError(isErrorCode(code) ? code : 'internal', 'room refused the connection');
  }
  try {
    if (fn !== undefined) await fn(conn);
    return transport.messages();
  } finally {
    room.detach(conn.id);
  }
}

/** The room's current snapshot as the given role would receive it on the wire. */
export async function snapshotFor(
  deps: HttpDeps,
  room: Room,
  role: Connection['role'],
  sub: string,
  bidderId?: string,
): Promise<{ frame: Record<string, unknown>; snapshot: RoomSnapshot }> {
  const frames = await withConnection(deps, room, role, sub, undefined, bidderId);
  const frame = frames.find((f) => f.t === 'state');
  if (frame === undefined) throw new GavelError('internal', 'room sent no state');
  return { frame, snapshot: frame.snapshot as RoomSnapshot };
}

export function mountAuctions(app: HttpApp): void {
  app.post('/api/auctions', async (c: Ctx) => {
    requireAdmin(c);
    const { title, config } = parseBody(CreateBody, await c.body());
    const { deps } = c;
    const auctionId = deps.ids.mint<'AuctionId'>();
    const auctioneerSub = deps.ids.mint<'Jti'>();
    await deps.store.putJournal(titleKey(auctionId), 0, { title });
    await deps.service.createAuction(auctionId, config, auctioneerSub);
    const auctioneer = await mintToken(deps, 'auctioneer', auctionId, auctioneerSub);
    const screen = await mintToken(deps, 'screen', auctionId, deps.ids.mint<'Jti'>());
    return json(201, {
      auctionId,
      auctioneerLink: linkFor(deps, auctionId, 'console', auctioneer.token),
      screenLink: linkFor(deps, auctionId, 'screen', screen.token),
    });
  });

  app.get('/api/auctions/:id', async (c: Ctx) => {
    const auctionId = auctionIdOf(c);
    const room = await roomFor(c.deps, auctionId);
    const { snapshot } = await snapshotFor(c.deps, room, 'screen', 'public');
    const stored = await c.deps.store.getJournal(titleKey(auctionId));
    const title =
      typeof (stored?.value as { title?: unknown } | undefined)?.title === 'string'
        ? (stored?.value as { title: string }).title
        : 'Untitled auction';
    return json(200, {
      auctionId,
      title,
      status: snapshot.status,
      endTs: snapshot.endTs,
      bidderCount: snapshot.roster.length,
    });
  });
}
