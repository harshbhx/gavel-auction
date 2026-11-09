import { createHash, timingSafeEqual } from 'node:crypto';
import {
  BIDDER_NAME_FORBIDDEN_PATTERN,
  EpochMs,
  ERROR_TABLE,
  GavelError,
  MAX_CENTS,
  MAX_NAME_CHARS,
  scrubMessage,
  type RoomSnapshot,
  type AuctionConfig,
  type Cents,
  type Logger,
} from '@gavel/shared';
import { ChainError, type LedgerStore, type Ulid } from '@gavel/engine';
import { z } from 'zod';
import { buildReplayBundle } from '../admin/replay-bundle';
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
  lotTitleSchema,
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
export const JUDGE_KEY_PATH = '/api/judge/key';
export const JUDGE_LEDGER_PATH = '/api/judge/rooms/:id/ledger';
/** Header that carries the judge key. Never a URL, never the body, never a log line. */
export const JUDGE_KEY_HEADER = 'x-judge-key';
/** Keyed creates the whole host accepts per hour, a second bound under the live-room bound. */
const KEYED_PER_HOUR = 20;

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
  /**
   * JUDGE_KEY: the limited key for judges. Left out, the key routes answer as if the key were
   * wrong and the capability probe says nothing about a key. It is never the operator key.
   */
  judgeKey?: string | undefined;
  /** Most keyed rooms alive at once (JUDGE_KEY_ROOMS_MAX). They do not use the public slots. */
  keyedMax?: number | undefined;
  /** The ledger the read-only reviewer route builds a verifiable bundle from. */
  ledger?: Pick<LedgerStore, 'read'> | undefined;
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

/** How long a joined session may sit without a hold before its seat is given back. */
const SEAT_IDLE_MS = 2 * 60_000;

export const JUDGE_JOIN_DEFAULTS: JudgeJoinLimits = {
  maxBiddersPerRoom: 20,
  attemptsPerIpPerMin: 10,
  wrongCodesBeforeLockout: 5,
  lockoutMs: 15 * 60_000,
};

export const JUDGE_ROOM_DEFAULTS = {
  maxLive: 15,
  ttlMs: 30 * 60_000,
  perIpPerHour: 12,
  globalPerHour: 40,
  lotWindowMs: 10 * 60_000,
} as const;

const CreateBody = z
  .object({
    title: lotTitleSchema(60).optional(),
    /** Optional fundraiser goal in integer cents; the projector shows a thermometer only when set. */
    fundraiserGoalCents: z.number().int().positive().max(MAX_CENTS).optional(),
  })
  .strict();

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
  /** Made with the judge key. */
  keyed?: true;
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

/** Constant-time comparison of two secrets of any length (both sides are hashed first). */
function secretsEqual(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
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
  judge_key_invalid: 'That key was not accepted.',
  judge_key_locked: 'Too many wrong tries. Try again later.',
  judge_key_room_cap: 'You already have the most judge rooms the server allows. Try again soon.',
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
  const live = new Map<string, { expiresAt: number; src: string; keyed?: true }>();
  const keyedMax = opts.keyedMax ?? 3;
  let keyedStamps: number[] = [];
  const perIp = new Map<string, number[]>();
  const joinLimits: JudgeJoinLimits = { ...JUDGE_JOIN_DEFAULTS, ...(opts.join ?? {}) };
  /**
   * Seats per room: bidder id -> when the session joined and whether it has a hold. A seat is
   * kept while its bidder holds a place in the room; a session that joined and never took a
   * hold frees its seat after `SEAT_IDLE_MS`, so idle or abandoned joins cannot fill a room.
   */
  const joined = new Map<string, Map<string, { at: number; registered: boolean }>>();
  const seatsOf = (
    roomId: string,
    now: number,
  ): Map<string, { at: number; registered: boolean }> => {
    let seats = joined.get(roomId);
    if (seats === undefined) {
      seats = new Map();
      joined.set(roomId, seats);
    }
    for (const [bidderId, seat] of seats) {
      if (!seat.registered && now - seat.at >= SEAT_IDLE_MS) seats.delete(bidderId);
    }
    return seats;
  };
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
          live.set(id, {
            expiresAt: m.expiresAt,
            src: 'restored',
            ...(m.keyed === true ? { keyed: true as const } : {}),
          });
        }
      }
      loaded = true;
    })();
    return loading;
  };

  const withinWindow = (stamps: number[], now: number): number[] =>
    stamps.filter((t) => now - t < HOUR_MS);

  /** Seconds until the oldest stamp leaves the hour window (at least 1). */
  const untilFree = (stamps: number[], now: number): number =>
    Math.max(1, Math.ceil(((stamps[0] ?? now) + HOUR_MS - now) / 1000));

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

  /** Rooms that use a public slot; keyed rooms have a bound of their own. */
  const publicLive = (): number => [...live.values()].filter((e) => e.keyed !== true).length;
  const keyedLive = (): number => live.size - publicLive();

  const accepting = (): boolean => opts.enabled && !paused && publicLive() < opts.maxLive;

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
    const { title, fundraiserGoalCents } = parseBody(CreateBody, await c.body());
    const src = requestSources.get(c.req) ?? 'unknown';
    const tag = sourceTag(src);
    // A request that names a key is judged by the key alone: the public limits do not apply to
    // it, and a wrong key never falls back to the public path.
    const keyed = c.req.headers.has(JUDGE_KEY_HEADER);
    if (keyed) {
      const refused = checkKey(c, tag, deps.clock.now());
      if (refused !== undefined) return refused;
    }
    if (paused) return refuse(deps, 503, 'judge_rooms_paused', 'paused', tag, 60);
    // A hammered room still holds a slot until the sweeper runs; free them before judging the cap.
    if (keyed ? keyedLive() >= keyedMax : publicLive() >= opts.maxLive) await sweep();
    const now = deps.clock.now();
    if (keyed) {
      keyedStamps = withinWindow(keyedStamps, now);
      if (keyedLive() >= keyedMax) {
        return refuse(deps, 429, 'judge_key_room_cap', 'key_cap', tag, 60);
      }
      if (keyedStamps.length >= KEYED_PER_HOUR) {
        return refuse(deps, 429, 'judge_rate_limited', 'key_hourly', tag, 600);
      }
      keyedStamps.push(now);
    } else {
      const mine = withinWindow(perIp.get(tag) ?? [], now);
      global = withinWindow(global, now);
      if (mine.length >= opts.perIpPerHour) {
        perIp.set(tag, mine);
        return refuse(deps, 429, 'judge_rate_limited', 'per_ip', tag, untilFree(mine, now));
      }
      if (global.length >= opts.globalPerHour) {
        return refuse(deps, 429, 'judge_rate_limited', 'global', tag, untilFree(global, now));
      }
      if (publicLive() >= opts.maxLive) {
        return refuse(deps, 429, 'judge_room_cap', 'cap', tag, 60);
      }
      // Count the attempt before the first await below, so a burst of concurrent creates
      // cannot overshoot either limit.
      mine.push(now);
      perIp.set(tag, mine);
      global.push(now);
    }
    const auctionId = deps.ids.mint<'AuctionId'>();
    const expiresAt = now + opts.ttlMs;
    live.set(auctionId, { expiresAt, src: tag, ...(keyed ? { keyed: true as const } : {}) });
    try {
      const lot = title ?? DEFAULT_TITLE;
      const auctioneerSub = deps.ids.mint<'Jti'>();
      const joinCode = await reserveJoinCode(deps, auctionId);
      await deps.store.putJournal(titleKey(auctionId), 0, {
        title: lot,
        joinCode,
        judgeRoom: true,
        ...(fundraiserGoalCents === undefined ? {} : { fundraiserGoalCents }),
      });
      await deps.store.putJournal(markerKey(auctionId), 0, {
        createdAt: now,
        expiresAt,
        ...(keyed ? { keyed: true as const } : {}),
      } satisfies Marker);
      const config = judgeRoomConfig(now, opts);
      await deps.service.createAuction(auctionId, config, auctioneerSub);
      const auctioneer = await mintToken(deps, 'auctioneer', auctionId, auctioneerSub);
      const screen = await mintToken(deps, 'screen', auctionId, deps.ids.mint<'Jti'>());
      const reviewer = await mintToken(deps, 'reviewer', auctionId, deps.ids.mint<'Jti'>());
      audit(deps)?.info('judge room created', {
        event: 'judge_room.created',
        auctionId,
        joinCode,
        src: tag,
        expiresAt,
        live: live.size,
        // Never the key itself: a field name with "key" in it would be redacted anyway.
        via: keyed ? 'judge-pass' : 'public',
      });
      return json(201, {
        auctionId,
        joinCode,
        lotTitle: lot,
        auctioneerToken: auctioneer.token,
        screenToken: screen.token,
        auctioneerLink: linkFor(deps, auctionId, 'console', auctioneer.token),
        screenLink: linkFor(deps, auctionId, 'screen', screen.token),
        reviewerToken: reviewer.token,
        reviewerLink: linkFor(deps, auctionId, 'audit', reviewer.token),
        expiresAt,
        biddingEndsAt: config.endTs,
        ...(keyed ? { unlocked: true } : {}),
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
   * Judges the judge key on a request. Returns undefined when it is right, otherwise the refusal.
   * A wrong key counts toward the same lockout as a wrong room code (one guard for both); a
   * locked-out source is refused even with the right key. The key is compared in constant time
   * and never logged.
   */
  const checkKey = (c: Ctx, tag: string, now: number): Response | undefined => {
    const { deps } = c;
    const guard = codeGuardOf(deps);
    // The lockout is checked without using up the join attempts of a shared address: a right key
    // costs nothing, a wrong one is a strike.
    const lockedFor = guard.lockedFor(tag, now);
    if (lockedFor > 0) return refuse(deps, 429, 'judge_key_locked', 'key_locked', tag, lockedFor);
    const given = c.req.headers.get(JUDGE_KEY_HEADER) ?? '';
    const expected = opts.judgeKey;
    // Always run the comparison, so an unset key costs the same time as a wrong one.
    const same = secretsEqual(given, expected ?? '\u0000unset');
    if (expected === undefined || given === '' || !same) {
      guard.noteWrong(tag, now);
      return refuse(deps, 401, 'judge_key_invalid', 'key_wrong', tag);
    }
    return undefined;
  };

  /** `POST /api/judge/key`: checks the key without creating anything, so the panel can say so. */
  const keyCheck = async (c: Ctx): Promise<Response> => {
    const { deps } = c;
    if (!opts.enabled) throw new HttpError(404, 'not_found', 'no such route');
    await load(deps);
    const tag = sourceTag(requestSources.get(c.req) ?? 'unknown');
    const refused = checkKey(c, tag, deps.clock.now());
    if (refused !== undefined) return refused;
    audit(deps)?.info('judge pass accepted', {
      event: 'judge_room.key_ok',
      src: tag,
      via: 'judge-pass',
    });
    return json(200, { ok: true, roomsMax: keyedMax, roomsLive: keyedLive() });
  };

  /**
   * `GET /api/judge/rooms/:id/ledger`: the room's hash-chained ledger as a replay bundle, for the
   * read-only reviewer link (or the auctioneer). Judge rooms only; the chain is checked before it
   * is sent, so a broken ledger answers 409 rather than a bundle that looks fine.
   */
  const ledgerBundle = async (c: Ctx): Promise<Response> => {
    const { deps } = c;
    const ledger = opts.ledger;
    if (!opts.enabled || ledger === undefined) {
      throw new HttpError(404, 'not_found', 'no such route');
    }
    const auctionId = c.params.id ?? '';
    await authenticate(c, auctionId, ['reviewer', 'auctioneer']);
    await load(deps);
    const marker = (await deps.store.getJournal(markerKey(auctionId)))?.value as Marker | undefined;
    if (marker === undefined) throw new GavelError('not_found', 'no such judge room');
    const entries = await ledger.read(auctionId as Ulid, 1);
    if (entries.length === 0) throw new GavelError('not_found', 'the ledger has no entries yet');
    try {
      const bundle = buildReplayBundle(auctionId, entries, deps.clock.now());
      audit(deps)?.info('judge room ledger read', {
        event: 'judge_room.ledger_read',
        auctionId,
        entries: bundle.count,
      });
      return json(200, bundle, { 'cache-control': 'no-store' });
    } catch (e) {
      if (!(e instanceof ChainError)) throw e;
      audit(deps)?.error('judge room ledger unverified', {
        event: 'judge_room.ledger_unverified',
        auctionId,
      });
      return json(409, { error: 'ledger_unverified' }, { 'cache-control': 'no-store' });
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
    const bidderId = deps.ids.mint<'BidderId'>();
    const seats = seatsOf(roomId, now);
    if (seats.size >= joinLimits.maxBiddersPerRoom) {
      return refuse(deps, 429, 'judge_room_full', 'join_full', tag, 60);
    }
    seats.set(bidderId, { at: now, registered: false });
    try {
      await roomFor(deps, roomId);
      const session = await mintToken(deps, 'session', roomId, bidderId, bidderId);
      audit(deps)?.info('judge room joined', {
        event: 'judge_room.joined',
        auctionId: roomId,
        src: tag,
        seats: seats.size,
      });
      return json(200, {
        auctionId: roomId,
        sessionToken: session.token,
        bidderId,
        displayName,
        wsUrl: wsUrlOf(deps),
      });
    } catch (e) {
      joined.get(roomId)?.delete(bidderId);
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
    // The bidder now has a hold, so its seat stays for as long as the room lives.
    seatsOf(auctionId, deps.clock.now()).set(who.bidderId, {
      at: deps.clock.now(),
      registered: true,
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
        // Present only when a judge key is set, so the panel shows its key field only then.
        ...(opts.enabled && opts.judgeKey !== undefined ? { keyed: true } : {}),
      });
    });
    app.post(JUDGE_ROOMS_PATH, judgeRoute(create));
    app.post(JUDGE_KEY_PATH, judgeRoute(keyCheck));
    app.get(JUDGE_LEDGER_PATH, judgeRoute(ledgerBundle));
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
