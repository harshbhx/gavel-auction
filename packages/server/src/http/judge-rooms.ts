import {
  BIDDER_NAME_FORBIDDEN_PATTERN,
  EpochMs,
  ERROR_TABLE,
  GavelError,
  MAX_NAME_CHARS,
  scrubMessage,
  type RoomSnapshot,
  type AuctionConfig,
  type Cents,
  type Logger,
} from '@gavel/shared';
import { z } from 'zod';
import { raiseAuctioneerFloor } from '../auth/auctioneer-floor';
import {
  authenticate,
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
import { codeGuardOf, sourceTag } from './code-guard';
import {
  auctionIdForCode,
  looksLikeJoinCode,
  normalizeJoinCode,
  linkFor,
  reserveJoinCode,
  roomFor,
  snapshotFor,
  titleKey,
} from './auctions';
import { wsUrlOf } from './invites';
import { requestSources } from './node-bridge';

export const JUDGE_ROOMS_PATH = '/api/judge/rooms';
export const JUDGE_JOIN_PATH = '/api/judge/join';
export const JUDGE_SIM_HOLD_PATH = '/api/judge/rooms/:id/sim-hold';
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
  /** Open-join limits (SRV-30); every field falls back to JUDGE_JOIN_DEFAULTS. */
  join?: Partial<JudgeJoinLimits>;
  /**
   * Simulated holds (a hold with no PayPal login, judge rooms only). Left out, the route answers
   * 404, which is how a host keeps it off.
   */
  simHolds?: SimHolds;
}

/** What the simulated-hold route needs from the host. */
export interface SimHolds {
  /** True while the auction still takes holds. */
  acceptsHolds(auctionId: string): Promise<boolean>;
  /** Writes the simulated hold, puts the bidder in the room and returns the hold id. */
  place(input: {
    auctionId: string;
    bidderId: string;
    name: string;
    ceilingCents: number;
  }): Promise<string>;
}

/** Limits of the open join route. Judge rooms only; a normal auction never uses it. */
export interface JudgeJoinLimits {
  /** Most bidder sessions the open join issues per room. */
  maxBiddersPerRoom: number;
  /** Join attempts one source address may make per minute, right or wrong. */
  attemptsPerIpPerMin: number;
  /** Wrong codes one source address may try before it is locked out. */
  wrongCodesBeforeLockout: number;
  /** How long a locked-out address is refused, in ms. */
  lockoutMs: number;
}

export const JUDGE_JOIN_DEFAULTS: JudgeJoinLimits = {
  maxBiddersPerRoom: 20,
  attemptsPerIpPerMin: 10,
  wrongCodesBeforeLockout: 5,
  lockoutMs: 15 * 60_000,
};

export const JUDGE_ROOM_DEFAULTS = {
  maxLive: 15,
  ttlMs: 30 * 60_000,
  perIpPerHour: 4,
  globalPerHour: 40,
  lotWindowMs: 10 * 60_000,
} as const;

const CreateBody = z.object({ title: z.string().trim().min(1).max(60).optional() }).strict();

const JoinBody = z
  .object({
    // Room codes are typed or pasted in many shapes ("gvl-abc 234"); the server cleans them up.
    code: z.string().trim().min(1).max(40),
    displayName: z
      .string()
      .trim()
      .min(1)
      .max(MAX_NAME_CHARS)
      .refine((v) => !BIDDER_NAME_FORBIDDEN_PATTERN.test(v), 'name holds a forbidden character'),
  })
  .strict();

const SimHoldBody = z
  .object({
    ceilingCents: z.number().int().positive(),
    name: z
      .string()
      .trim()
      .min(1)
      .max(MAX_NAME_CHARS)
      .refine((v) => !BIDDER_NAME_FORBIDDEN_PATTERN.test(v), 'name holds a forbidden character'),
  })
  .strict();

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

/** True once the lot was hammered, stopped or settled: nobody can usefully join any more. */
function isEnded(snapshot: RoomSnapshot): boolean {
  return snapshot.status === 'DONE' || snapshot.hammer !== undefined || snapshot.stopped === true;
}

/** What each refusal says to a person. `error` stays the stable code the web app switches on. */
const REFUSAL_TEXT: Readonly<Record<string, string>> = {
  judge_rooms_paused: 'Demo rooms are paused right now. Try again in a minute.',
  judge_rate_limited: 'Too many tries from this network. Wait a few minutes and try again.',
  judge_room_cap: 'All demo rooms are in use. Try again in a minute.',
  judge_room_full: 'Room is full',
  judge_room_expired: 'That room has ended',
  judge_room_ended: 'That room has ended',
  judge_join_locked: 'Too many wrong codes. Try again later.',
  not_found: 'Code not found, check and try again',
};

/**
 * Judge routes answer errors as `{ error, message }` (`error` is the stable code, `message` is
 * for a person); `code` and `detail` ride along for clients that read the common error shape.
 */
function judgeRoute(handler: (c: Ctx) => Promise<Response>): (c: Ctx) => Promise<Response> {
  return async (c) => {
    try {
      return await handler(c);
    } catch (e) {
      if (!(e instanceof GavelError) || e.code === 'internal') throw e;
      const status = e instanceof HttpError ? e.status : ERROR_TABLE[e.code].status;
      const detail = e instanceof HttpError ? e.detail : undefined;
      return json(status, {
        error: e.code,
        code: e.code,
        message: scrubMessage(e.message),
        ...(detail === undefined ? {} : { detail: scrubMessage(detail) }),
      });
    }
  };
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
  const joinLimits: JudgeJoinLimits = { ...JUDGE_JOIN_DEFAULTS, ...(opts.join ?? {}) };
  /** Bidder sessions the open join issued per room. */
  const joined = new Map<string, number>();
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
    message?: string,
  ): Response => {
    audit(deps)?.warn('judge room refused', { event: 'judge_room.refused', reason: why, src });
    return json(
      status,
      { error, message: message ?? REFUSAL_TEXT[error] ?? 'Request refused' },
      retryAfterS === undefined ? {} : { 'retry-after': String(retryAfterS) },
    );
  };

  const accepting = (): boolean => opts.enabled && !paused && live.size < opts.maxLive;

  const expire = async (deps: HttpDeps, id: string, why: 'ttl' | 'done'): Promise<void> => {
    const entry = live.get(id);
    live.delete(id);
    joined.delete(id);
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
            if (isEnded(snapshot)) {
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
    // A hammered room still holds a slot until the sweeper runs; free them before judging the cap.
    if (live.size >= opts.maxLive) await sweep();
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
      await deps.store.putJournal(titleKey(auctionId), 0, {
        title: lot,
        joinCode,
        judgeRoom: true,
      });
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

  /**
   * `POST /api/judge/join` (SRV-30): a bidder joins a judge room with its 6-letter code and a
   * display name, and gets the same session token an invite join would give. Judge rooms only:
   * a code of any other auction answers exactly like an unknown code.
   */
  const join = async (c: Ctx): Promise<Response> => {
    const { deps } = c;
    if (!opts.enabled) throw new HttpError(404, 'not_found', 'no such route');
    const { code, displayName } = parseBody(JoinBody, await c.body());
    await load(deps);
    const src = requestSources.get(c.req) ?? 'unknown';
    const tag = sourceTag(src);
    const now = deps.clock.now();
    const guard = codeGuardOf(deps);
    const verdict = guard.attempt(tag, now);
    if (!verdict.ok) {
      return verdict.reason === 'locked'
        ? refuse(deps, 429, 'judge_join_locked', 'join_locked', tag, verdict.retryAfterS)
        : refuse(
            deps,
            429,
            'judge_rate_limited',
            'join_per_ip',
            tag,
            verdict.retryAfterS,
            'Too many tries. Wait a minute and try again.',
          );
    }

    let auctionId: string | undefined;
    try {
      auctionId = await auctionIdForCode(deps, code);
    } catch (e) {
      if (!(e instanceof GavelError && e.code === 'not_found')) throw e;
    }
    const marker =
      auctionId === undefined
        ? undefined
        : ((await deps.store.getJournal(markerKey(auctionId)))?.value as Marker | undefined);
    if (auctionId === undefined || marker === undefined) {
      // An unknown code and the code of a normal auction look the same to the caller. A code
      // that is not even shaped like one is a typo, not a guess: it costs an attempt, no strike.
      if (looksLikeJoinCode(code)) guard.noteWrong(tag, now, normalizeJoinCode(code));
      return refuse(deps, 404, 'not_found', 'join_wrong_code', tag);
    }
    if (marker.expired === true || marker.expiresAt <= now) {
      return refuse(deps, 410, 'judge_room_expired', 'join_expired', tag);
    }
    {
      // A hammered room takes no one: say so, and give its slot back without waiting for the sweep.
      const room = await roomFor(deps, auctionId);
      const { snapshot } = await snapshotFor(deps, room, 'screen', 'judge-join');
      if (isEnded(snapshot)) {
        await expire(deps, auctionId, 'done');
        return refuse(deps, 410, 'judge_room_ended', 'join_ended', tag);
      }
    }
    const roomId: string = auctionId;
    // Reserve the seat before the first await below.
    const taken = joined.get(roomId) ?? 0;
    if (taken >= joinLimits.maxBiddersPerRoom) {
      return refuse(deps, 429, 'judge_room_full', 'join_full', tag, 60);
    }
    joined.set(roomId, taken + 1);
    try {
      await roomFor(deps, roomId);
      const bidderId = deps.ids.mint<'BidderId'>();
      const session = await mintToken(deps, 'session', roomId, bidderId, bidderId);
      audit(deps)?.info('judge room joined', {
        event: 'judge_room.joined',
        auctionId: roomId,
        src: tag,
        seats: taken + 1,
      });
      return json(200, {
        auctionId: roomId,
        sessionToken: session.token,
        bidderId,
        displayName,
        wsUrl: wsUrlOf(deps),
      });
    } catch (e) {
      joined.set(roomId, Math.max(0, (joined.get(roomId) ?? 1) - 1));
      throw e;
    }
  };

  /**
   * `POST /api/judge/rooms/:id/sim-hold`: a bidder session of a judge room gets a simulated hold,
   * so the room can be tried with no PayPal login. Judge rooms only: any other auction answers
   * `not_found`, whatever the session.
   */
  const simHold = async (c: Ctx): Promise<Response> => {
    const { deps } = c;
    const sim = opts.simHolds;
    if (!opts.enabled || sim === undefined) throw new HttpError(404, 'not_found', 'no such route');
    const auctionId = c.params.id ?? '';
    const who = await authenticate(c, auctionId, ['session']);
    if (who.bidderId === undefined) throw new GavelError('forbidden', 'no bidder in the session');
    const body = parseBody(SimHoldBody, await c.body());
    await load(deps);
    const marker = (await deps.store.getJournal(markerKey(auctionId)))?.value as Marker | undefined;
    if (marker === undefined) throw new GavelError('not_found', 'no such judge room');
    if (marker.expired === true || marker.expiresAt <= deps.clock.now()) {
      return refuse(deps, 410, 'judge_room_expired', 'sim_hold_expired', sourceTag(auctionId));
    }
    const room = await roomFor(deps, auctionId);
    const { snapshot } = await snapshotFor(deps, room, 'screen', 'judge-sim-hold');
    if (!snapshot.config.ceilingPresets.includes(body.ceilingCents as Cents)) {
      throw new GavelError('bad_message', 'ceiling is not one of the offered amounts');
    }
    if (!(await sim.acceptsHolds(auctionId))) {
      throw new GavelError('closed', 'the auction no longer takes holds');
    }
    const holdId = await sim.place({
      auctionId,
      bidderId: who.bidderId,
      name: body.name,
      ceilingCents: body.ceilingCents,
    });
    audit(deps)?.info('judge room simulated hold', {
      event: 'judge_room.sim_hold',
      auctionId,
      ceilingCents: body.ceilingCents,
    });
    return json(200, { holdId, simulated: true, ceilingCents: body.ceilingCents });
  };

  const mount: Mount = (app: HttpApp): void => {
    appDeps = app.deps;
    codeGuardOf(app.deps, joinLimits);
    app.post(JUDGE_JOIN_PATH, judgeRoute(join));
    app.post(JUDGE_SIM_HOLD_PATH, judgeRoute(simHold));
    app.get(JUDGE_CAPABILITIES_PATH, async (c: Ctx) => {
      if (opts.enabled) {
        await load(c.deps);
        if (live.size >= opts.maxLive) await sweep().catch(() => 0);
      }
      return json(200, {
        judgeRooms: opts.enabled,
        accepting: accepting(),
        simHolds: opts.enabled && opts.simHolds !== undefined,
      });
    });
    app.post(JUDGE_ROOMS_PATH, judgeRoute(create));
    app.post(
      JUDGE_PAUSE_PATH,
      judgeRoute(async (c: Ctx) => {
        requireAdmin(c);
        const body = parseBody(PauseBody, await c.body());
        await load(c.deps);
        const prev = await c.deps.store.getJournal(PAUSED_KEY);
        await c.deps.store.putJournal(PAUSED_KEY, prev?.version ?? 0, { paused: body.paused });
        paused = body.paused;
        audit(c.deps)?.warn('judge rooms switch', { event: 'judge_room.switch', paused });
        return json(200, { paused });
      }),
    );
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
