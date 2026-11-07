import { createHash } from 'node:crypto';
import { clientKey, EpochMs, type AuctionConfig, type Cents, type Logger } from '@gavel/shared';
import { z } from 'zod';
import { raiseAuctioneerFloor } from '../auth/auctioneer-floor';
import {
  json,
  mintToken,
  parseBody,
  requireAdmin,
  HttpError,
  type Ctx,
  type HttpApp,
  type HttpDeps,
  type Mount,
} from './app';
import { linkFor, reserveJoinCode, roomFor, snapshotFor, titleKey } from './auctions';
import { requestSources } from './node-bridge';

export const JUDGE_ROOMS_PATH = '/api/judge/rooms';
export const JUDGE_CAPABILITIES_PATH = '/api/judge/capabilities';
export const JUDGE_PAUSE_PATH = '/api/judge/pause';

const HOUR_MS = 3_600_000;
const DEFAULT_TITLE = 'Sandbox demo lot';
const PAUSED_KEY = 'judge:paused';
const markerKey = (auctionId: string): string => `judge:room:${auctionId}`;
/** The audit actor recorded when the sweeper ends a judge room. */
const EXPIRY_ACTOR = 'judge-room-expiry';

export interface JudgeRoomsOptions {
  /** JUDGE_ROOMS. When false the create route answers 404 and the probe says so. */
  enabled: boolean;
  /** JUDGE_ROOMS_PAUSED: boot-time state of the global kill switch. */
  paused: boolean;
  /** Most judge rooms live at once (JUDGE_ROOMS_MAX). */
  maxLive: number;
  /** Lifetime of a room before the sweeper ends it (JUDGE_ROOM_TTL_MS). */
  ttlMs: number;
  /** Creates one source address may make per hour. */
  perIpPerHour: number;
  /** Creates the whole host accepts per hour. */
  globalPerHour: number;
  /** Payments ceiling cap in cents; the lot's ceiling presets never exceed it. */
  maxCeilingCents: number;
  /** Bidding window of the lot, in ms from creation. */
  lotWindowMs: number;
}

export const JUDGE_ROOM_DEFAULTS = {
  maxLive: 5,
  ttlMs: 30 * 60_000,
  perIpPerHour: 4,
  globalPerHour: 40,
  lotWindowMs: 10 * 60_000,
} as const;

const CreateBody = z.object({ title: z.string().trim().min(1).max(60).optional() }).strict();

const PauseBody = z.object({ paused: z.boolean() }).strict();

interface Marker {
  createdAt: number;
  expiresAt: number;
  expired?: true;
}

/** Fixed, safe lot settings: short timers, small money, ceilings under the payments cap. */
export function judgeRoomConfig(
  nowMs: number,
  opts: Pick<JudgeRoomsOptions, 'lotWindowMs' | 'maxCeilingCents'>,
): AuctionConfig {
  const presets = [...new Set([2_000, 5_000].map((c) => Math.min(c, opts.maxCeilingCents)))];
  return {
    mode: 'english',
    currency: 'USD',
    reserve: 1_000 as Cents,
    minIncrement: 500 as Cents,
    endTs: EpochMs(nowMs + opts.lotWindowMs),
    softCloseWindowMs: 15_000,
    softCloseExtensionMs: 15_000,
    maxExtensions: 2,
    ceilingPresets: presets as Cents[],
    confirmConfidenceThreshold: 0.85,
  };
}

/** A short stable tag for a source address, so the audit trail never holds the address itself. */
function sourceTag(source: string): string {
  return createHash('sha256').update(clientKey(source)).digest('hex').slice(0, 12);
}

export interface JudgeRooms {
  mount: Mount;
  /** Ends every room past its lifetime and frees the slots of finished ones. Returns rooms ended. */
  sweep(): Promise<number>;
  /** Starts the periodic sweep; the timer does not keep the process alive. */
  start(everyMs?: number): void;
  stop(): void;
  /** Rooms currently counted against the cap. */
  liveCount(): number;
}

/**
 * Judge rooms: a real auction room that anyone can open on a sandbox-only host, behind explicit
 * guards. The creator gets room-scoped tokens only; every admin route still needs the operator key.
 */
export function createJudgeRooms(opts: JudgeRoomsOptions): JudgeRooms {
  /** Live rooms: id -> expiry and creator tag. */
  const live = new Map<string, { expiresAt: number; src: string }>();
  const perIp = new Map<string, number[]>();
  let global: number[] = [];
  let paused = opts.paused;
  let loaded = false;
  let loading: Promise<void> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let sweeping: Promise<number> | undefined;
  let appDeps: HttpDeps | undefined;

  const audit = (deps: HttpDeps): Logger | undefined =>
    deps.log?.child({ judgeRoom: true, channel: 'judge-room' });

  /** Reads the persisted pause flag and the unexpired rooms once, so a restart keeps both. */
  const load = (deps: HttpDeps): Promise<void> => {
    if (loaded) return Promise.resolve();
    loading ??= (async () => {
      const flag = await deps.store.getJournal(PAUSED_KEY);
      const stored = (flag?.value as { paused?: unknown } | undefined)?.paused;
      if (typeof stored === 'boolean') paused = stored || opts.paused;
      for (const id of await deps.store.listAuctions()) {
        const m = (await deps.store.getJournal(markerKey(id)))?.value as Marker | undefined;
        if (m !== undefined && m.expired !== true) {
          live.set(id, { expiresAt: m.expiresAt, src: 'restored' });
        }
      }
      loaded = true;
    })();
    return loading;
  };

  const withinWindow = (stamps: number[], now: number): number[] =>
    stamps.filter((t) => now - t < HOUR_MS);

  const refuse = (
    deps: HttpDeps,
    status: number,
    error: string,
    why: string,
    src: string,
    retryAfterS?: number,
  ): Response => {
    audit(deps)?.warn('judge room refused', { event: 'judge_room.refused', reason: why, src });
    return json(
      status,
      { error },
      retryAfterS === undefined ? {} : { 'retry-after': String(retryAfterS) },
    );
  };

  const accepting = (): boolean => opts.enabled && !paused && live.size < opts.maxLive;

  const expire = async (deps: HttpDeps, id: string, why: 'ttl' | 'done'): Promise<void> => {
    const entry = live.get(id);
    live.delete(id);
    const log = audit(deps);
    try {
      if (why === 'ttl') {
        const room = await roomFor(deps, id);
        await room.abort(EXPIRY_ACTOR);
        // A creator's link dies with the room, even though the token itself lasts hours.
        await raiseAuctioneerFloor(deps.store, id, Math.floor(deps.clock.now() / 1000) + 1);
        await room.dropDeadTokens();
      }
      const prev = await deps.store.getJournal(markerKey(id));
      const value = prev?.value as Marker | undefined;
      if (prev !== null && value !== undefined && value.expired !== true) {
        await deps.store.putJournal(markerKey(id), prev.version, { ...value, expired: true });
      }
      log?.info('judge room ended', { event: 'judge_room.ended', auctionId: id, why });
    } catch (e) {
      // Keep the slot counted: the next sweep tries again rather than leaking a live room.
      if (entry !== undefined) live.set(id, entry);
      log?.error('judge room cleanup failed', {
        event: 'judge_room.cleanup_failed',
        auctionId: id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const sweep = (): Promise<number> => {
    const deps = appDeps;
    if (deps === undefined) return Promise.resolve(0);
    sweeping ??= (async () => {
      let ended = 0;
      try {
        await load(deps);
        const now = deps.clock.now();
        for (const [id, entry] of [...live]) {
          if (entry.expiresAt <= now) {
            await expire(deps, id, 'ttl');
            ended += 1;
            continue;
          }
          try {
            const room = await roomFor(deps, id);
            const { snapshot } = await snapshotFor(deps, room, 'screen', 'judge-room-sweep');
            if (snapshot.status === 'DONE') {
              await expire(deps, id, 'done');
              ended += 1;
            }
          } catch {
            // An unreadable room is handled when its lifetime runs out.
          }
        }
      } finally {
        sweeping = undefined;
      }
      return ended;
    })();
    return sweeping;
  };

  const create = async (c: Ctx): Promise<Response> => {
    const { deps } = c;
    if (!opts.enabled) throw new HttpError(404, 'not_found', 'no such route');
    await load(deps);
    // Read the body before the limit checks: no await may sit between a check and its reservation.
    const { title } = parseBody(CreateBody, await c.body());
    const src = requestSources.get(c.req) ?? 'unknown';
    const tag = sourceTag(src);
    if (paused) return refuse(deps, 503, 'judge_rooms_paused', 'paused', tag, 60);
    const now = deps.clock.now();
    const mine = withinWindow(perIp.get(tag) ?? [], now);
    global = withinWindow(global, now);
    if (mine.length >= opts.perIpPerHour) {
      perIp.set(tag, mine);
      return refuse(deps, 429, 'judge_rate_limited', 'per_ip', tag, 600);
    }
    if (global.length >= opts.globalPerHour) {
      return refuse(deps, 429, 'judge_rate_limited', 'global', tag, 600);
    }
    if (live.size >= opts.maxLive) {
      return refuse(deps, 429, 'judge_room_cap', 'cap', tag, 60);
    }
    // Count the attempt and reserve the slot before the first await below, so a burst of
    // concurrent creates cannot overshoot either limit.
    mine.push(now);
    perIp.set(tag, mine);
    global.push(now);
    const auctionId = deps.ids.mint<'AuctionId'>();
    const expiresAt = now + opts.ttlMs;
    live.set(auctionId, { expiresAt, src: tag });
    try {
      const lot = title ?? DEFAULT_TITLE;
      const auctioneerSub = deps.ids.mint<'Jti'>();
      const joinCode = await reserveJoinCode(deps, auctionId);
      await deps.store.putJournal(titleKey(auctionId), 0, { title: lot, joinCode });
      await deps.store.putJournal(markerKey(auctionId), 0, {
        createdAt: now,
        expiresAt,
      } satisfies Marker);
      const config = judgeRoomConfig(now, opts);
      await deps.service.createAuction(auctionId, config, auctioneerSub);
      const auctioneer = await mintToken(deps, 'auctioneer', auctionId, auctioneerSub);
      const screen = await mintToken(deps, 'screen', auctionId, deps.ids.mint<'Jti'>());
      audit(deps)?.info('judge room created', {
        event: 'judge_room.created',
        auctionId,
        joinCode,
        src: tag,
        expiresAt,
        live: live.size,
      });
      return json(201, {
        auctionId,
        joinCode,
        lotTitle: lot,
        auctioneerToken: auctioneer.token,
        screenToken: screen.token,
        auctioneerLink: linkFor(deps, auctionId, 'console', auctioneer.token),
        screenLink: linkFor(deps, auctionId, 'screen', screen.token),
        expiresAt,
        biddingEndsAt: config.endTs,
      });
    } catch (e) {
      live.delete(auctionId);
      audit(deps)?.error('judge room create failed', {
        event: 'judge_room.create_failed',
        auctionId,
        error: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  };

  const mount: Mount = (app: HttpApp): void => {
    appDeps = app.deps;
    app.get(JUDGE_CAPABILITIES_PATH, async (c: Ctx) => {
      if (opts.enabled) await load(c.deps);
      return json(200, { judgeRooms: opts.enabled, accepting: accepting() });
    });
    app.post(JUDGE_ROOMS_PATH, create);
    app.post(JUDGE_PAUSE_PATH, async (c: Ctx) => {
      requireAdmin(c);
      const body = parseBody(PauseBody, await c.body());
      await load(c.deps);
      const prev = await c.deps.store.getJournal(PAUSED_KEY);
      await c.deps.store.putJournal(PAUSED_KEY, prev?.version ?? 0, { paused: body.paused });
      paused = body.paused;
      audit(c.deps)?.warn('judge rooms switch', { event: 'judge_room.switch', paused });
      return json(200, { paused });
    });
  };

  return {
    mount,
    sweep,
    start: (everyMs = 30_000) => {
      if (timer !== undefined || !opts.enabled) return;
      timer = setInterval(() => void sweep().catch(() => undefined), everyMs);
      timer.unref();
    },
    stop: () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    },
    liveCount: () => live.size,
  };
}
