import {
  AuctionConfigSchema,
  Cents,
  GavelError,
  isErrorCode,
  LOT_TITLE_FORBIDDEN_PATTERN,
  MAX_CENTS,
  type AuctionId,
  type BidderId,
  type ConnId,
  type RoomSnapshot,
  isUlid,
} from '@gavel/shared';
import { z } from 'zod';
import { codeGuardOf, sourceTag } from './code-guard';
import { requestSources } from './node-bridge';
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

/** A lot title: trimmed, 1..max characters, no control, zero-width or bidi characters. */
export const lotTitleSchema = (max: number): z.ZodEffects<z.ZodString, string, string> =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((v) => !LOT_TITLE_FORBIDDEN_PATTERN.test(v), 'title holds a forbidden character');

const CreateBody = z
  .object({
    title: lotTitleSchema(120).default('Untitled auction'),
    config: AuctionConfigSchema,
    /** Optional fundraiser goal in integer cents; the projector shows a thermometer only when set. */
    fundraiserGoalCents: z.number().int().positive().max(MAX_CENTS).optional(),
  })
  .strict();

export const titleKey = (auctionId: string): string => `http:title:${auctionId}`;
const codeKey = (code: string): string => `http:joincode:${code}`;

/** Letters and digits without look-alikes (no 0 O 1 I L), so a code can be read out loud. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const CODE_TRIES = 12;
const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

function randomCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  globalThis.crypto.getRandomValues(bytes);
  // Bytes at or above the largest multiple of the alphabet size are skewed; redraw them.
  const limit = 256 - (256 % CODE_ALPHABET.length);
  let out = '';
  for (let b of bytes) {
    while (b >= limit) b = globalThis.crypto.getRandomValues(new Uint8Array(1))[0] ?? 0;
    out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  }
  return out;
}

/** Reserve a join code no other auction holds; the journal's version check makes it unique. */
export async function reserveJoinCode(deps: HttpDeps, auctionId: string): Promise<string> {
  for (let i = 0; i < CODE_TRIES; i++) {
    const code = randomCode();
    try {
      await deps.store.putJournal(codeKey(code), 0, { auctionId });
      return code;
    } catch (e) {
      if (!(e instanceof GavelError && e.code === 'conflict')) throw e;
    }
  }
  throw new GavelError('internal', 'no free join code');
}

/**
 * A typed or pasted join code, cleaned up: any case, with spaces and dashes dropped, and the
 * `GVL-` prefix of the printed form removed ("gvl-abc 234" is "ABC234").
 */
export function normalizeJoinCode(raw: string): string {
  const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return code.length === CODE_LENGTH + 3 && code.startsWith('GVL') ? code.slice(3) : code;
}

/** True when the text, once cleaned up, has the shape of a join code (it may still not exist). */
export function looksLikeJoinCode(raw: string): boolean {
  return CODE_RE.test(normalizeJoinCode(raw));
}

/** The auction id behind a join code, or `not_found`. The code is case-insensitive. */
export async function auctionIdForCode(deps: HttpDeps, raw: string): Promise<string> {
  const code = normalizeJoinCode(raw);
  const stored = CODE_RE.test(code) ? await deps.store.getJournal(codeKey(code)) : null;
  const id = (stored?.value as { auctionId?: unknown } | undefined)?.auctionId;
  if (typeof id !== 'string')
    throw new GavelError('not_found', 'Code not found, check and try again');
  return id;
}

/** The auction id of the route: a full id, or a join code where `allowCode` is set. */
export async function auctionIdOrCode(c: Ctx): Promise<string> {
  const raw = c.params.id;
  if (raw !== undefined && !isUlid(raw)) return auctionIdForCode(c.deps, raw);
  return auctionIdOf(c);
}

export interface AuctionMeta {
  title: string | undefined;
  joinCode: string | undefined;
  fundraiserGoalCents: number | undefined;
  /** True for a key-less judge room (set when it is made). */
  judgeRoom: boolean;
}

/** Public facts kept beside the log: the title and the join code. Older auctions have no code. */
export async function auctionMeta(deps: HttpDeps, auctionId: string): Promise<AuctionMeta> {
  const stored = await deps.store.getJournal(titleKey(auctionId));
  const v = stored?.value as
    | { title?: unknown; joinCode?: unknown; fundraiserGoalCents?: unknown; judgeRoom?: unknown }
    | undefined;
  return {
    title: typeof v?.title === 'string' ? v.title : undefined,
    joinCode: typeof v?.joinCode === 'string' ? v.joinCode : undefined,
    judgeRoom: v?.judgeRoom === true,
    fundraiserGoalCents:
      typeof v?.fundraiserGoalCents === 'number' &&
      Number.isSafeInteger(v.fundraiserGoalCents) &&
      v.fundraiserGoalCents > 0
        ? v.fundraiserGoalCents
        : undefined,
  };
}

/** A snapshot with the public title and join code added; both are optional on the wire. */
export function withMeta(snapshot: RoomSnapshot, meta: AuctionMeta): RoomSnapshot {
  return {
    ...snapshot,
    ...(meta.title !== undefined ? { lotTitle: meta.title } : {}),
    ...(meta.joinCode !== undefined ? { joinCode: meta.joinCode } : {}),
    // A stored goal above the money limit (made before it was enforced) is left out, not thrown.
    ...(meta.fundraiserGoalCents !== undefined && meta.fundraiserGoalCents <= MAX_CENTS
      ? { fundraiser: { goalCents: Cents(meta.fundraiserGoalCents) } }
      : {}),
  };
}

/** Link the host hands out for a role, on the web origin (not the API host). The token rides in the fragment so it never reaches a log. */
export function linkFor(deps: HttpDeps, auctionId: string, page: string, token: string): string {
  return `${deps.webOrigin ?? deps.publicUrl}/r/${auctionId}/${page}#token=${token}`;
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
    const { title, config, fundraiserGoalCents } = parseBody(CreateBody, await c.body());
    const { deps } = c;
    const auctionId = deps.ids.mint<'AuctionId'>();
    const auctioneerSub = deps.ids.mint<'Jti'>();
    const joinCode = await reserveJoinCode(deps, auctionId);
    await deps.store.putJournal(titleKey(auctionId), 0, {
      title,
      joinCode,
      ...(fundraiserGoalCents === undefined ? {} : { fundraiserGoalCents }),
    });
    await deps.service.createAuction(auctionId, config, auctioneerSub);
    const auctioneer = await mintToken(deps, 'auctioneer', auctionId, auctioneerSub);
    const screen = await mintToken(deps, 'screen', auctionId, deps.ids.mint<'Jti'>());
    return json(201, {
      auctionId,
      joinCode,
      lotTitle: title,
      auctioneerLink: linkFor(deps, auctionId, 'console', auctioneer.token),
      screenLink: linkFor(deps, auctionId, 'screen', screen.token),
    });
  });

  app.get('/api/auctions/:id', async (c: Ctx) => {
    const raw = c.params.id;
    let auctionId: string;
    if (raw !== undefined && !isUlid(raw)) {
      // A short code is a guessable key, and this route is public: it shares the join throttle.
      const guard = codeGuardOf(c.deps);
      const tag = sourceTag(requestSources.get(c.req) ?? 'unknown');
      const now = c.deps.clock.now();
      const verdict = guard.attempt(tag, now, 'lookup');
      if (!verdict.ok) {
        const locked = verdict.reason === 'locked';
        return json(
          429,
          {
            error: locked ? 'code_locked' : 'rate_limited',
            message: locked
              ? 'Too many wrong codes. Try again later.'
              : 'Too many tries. Wait a minute and try again.',
          },
          { 'retry-after': String(verdict.retryAfterS) },
        );
      }
      try {
        auctionId = await auctionIdForCode(c.deps, raw);
      } catch (e) {
        if (e instanceof GavelError && e.code === 'not_found' && looksLikeJoinCode(raw)) {
          guard.noteWrong(tag, now, normalizeJoinCode(raw), 'lookup');
        }
        throw e;
      }
    } else {
      auctionId = await auctionIdOrCode(c);
    }
    const room = await roomFor(c.deps, auctionId);
    const { snapshot } = await snapshotFor(c.deps, room, 'screen', 'public');
    const meta = await auctionMeta(c.deps, auctionId);
    const title = meta.title ?? 'Untitled auction';
    const leaderPaddle = snapshot.roster.find((r) => r.bidderId === snapshot.leaderId)?.paddle;
    return json(200, {
      auctionId,
      title,
      ...(meta.joinCode !== undefined ? { joinCode: meta.joinCode } : {}),
      ...(meta.judgeRoom ? { judgeRoom: true } : {}),
      ...(snapshot.registrationClosed ? { registrationClosed: true } : {}),
      ...(snapshot.stopped ? { stopped: true } : {}),
      status: snapshot.status,
      endTs: snapshot.endTs,
      bidderCount: snapshot.roster.length,
      // The price and the leader's paddle are what the big screen shows to the whole room.
      ...(snapshot.price !== null ? { currentCents: snapshot.price } : {}),
      ...(leaderPaddle !== undefined ? { leaderPaddle } : {}),
    });
  });
}
