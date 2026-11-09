import {
  BIDDER_NAME_FORBIDDEN_PATTERN,
  EpochMs,
  ERROR_TABLE,
  GavelError,
  HOLD_ERROR_STATUS,
  MAX_CENTS,
  MAX_NAME_CHARS,
  MIN_CEILING_CENTS,
  scrubMessage,
  type RoomSnapshot,
  type AuctionConfig,
  type Cents,
  type Logger,
} from '@gavel/shared';
import { ChainError, type LedgerStore, type Ulid } from '@gavel/engine';
import { HoldError } from '@gavel/payments';
import { z } from 'zod';
import { buildReplayBundle } from '../admin/replay-bundle';
import { raiseAuctioneerFloor } from '../auth/auctioneer-floor';
import { JudgeKeyRegistry, LEGACY_KEY_ID, type JudgeKeyEntry } from '../auth/judge-keys';
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
import { codeGuardOf, keyGuardOf, sourceTag } from './code-guard';
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
  withConnection,
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
export const JUDGE_BID_PATH = '/api/judge/rooms/:id/bids';
/** Admin only (x-admin-key): list the judge keys, or revoke one. Never answers a hash. */
export const JUDGE_KEYS_PATH = '/api/judge/keys';
export const JUDGE_KEY_REVOKE_PATH = '/api/judge/keys/:keyId/revoke';
/** Header that carries the judge key. Never a URL, never the body, never a log line. */
export const JUDGE_KEY_HEADER = 'x-judge-key';
/** Default for keyed creates the whole host accepts per hour (`JudgeRoomsOptions.keyedPerHour`). */
const KEYED_PER_HOUR = 100;

const HOUR_MS = 3_600_000;
const DEFAULT_TITLE = 'Sandbox demo lot';
const PAUSED_KEY = 'judge:paused';
/** Journal row that holds the ids of revoked judge keys, so a revoke survives a restart. */
const KEYS_KEY = 'judge:keys';
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
  /**
   * Per-judge keys (JUDGE_KEYS) with the legacy shared key as one more entry. When given it
   * replaces `judgeKey`; the host builds it with the legacy key inside.
   */
  keys?: JudgeKeyRegistry | undefined;
  /** Most keyed rooms alive at once (JUDGE_KEY_ROOMS_MAX). They do not use the public slots. */
  keyedMax?: number | undefined;
  /** Keyed creates the whole host accepts per hour (JUDGE_KEY_CREATES_PER_HOUR). */
  keyedPerHour?: number | undefined;
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
  /** Drops the room's simulated holds from the hold store (only those) and returns the count. */
  purge?(auctionId: string): Promise<number>;
}

/**
 * How long an ended room keeps its simulated holds before they are purged, so a settlement or
 * void that is still running (or a retry of it) finds them.
 */
export const SIM_PURGE_GRACE_MS = 10 * 60_000;

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

const BidBody = z
  .object({
    /** Integer cents, like the socket's bid frame. */
    amount: z.number().int().positive().max(MAX_CENTS),
    /** Optional message id (a ULID): sending the same one again is a safe retry. */
    mid: z
      .string()
      .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'mid must be a ULID')
      .optional(),
  })
  .strict();

interface Marker {
  createdAt: number;
  expiresAt: number;
  expired?: true;
  /** When the room ended (hammer or expiry); the simulated holds are purged a grace after it. */
  endedAt?: number;
  /** The room's simulated holds have been dropped from the hold store. */
  simPurged?: true;
  /** Made with a judge key. */
  keyed?: true;
  /** Which key made it (an id, never the secret); absent on rooms made before per-key keys. */
  keyId?: string;
}

/** Fixed, safe lot settings: short timers, small money, ceilings under the payments cap. */
export function judgeRoomConfig(
  nowMs: number,
  opts: Pick<JudgeRoomsOptions, 'lotWindowMs' | 'maxCeilingCents'>,
): AuctionConfig {
  const presets = [
    ...new Set([2_000, 5_000, 10_000, 25_000].map((c) => Math.min(c, opts.maxCeilingCents))),
  ];
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
  judge_key_invalid: 'That key was not accepted.',
  judge_key_expired: 'That key has expired.',
  judge_key_revoked: 'That key was revoked.',
  judge_key_locked: 'Too many wrong tries. Try again later.',
  judge_key_room_cap: 'You already have the most judge rooms the server allows. Try again soon.',
  judge_host_busy: 'The sandbox is busy right now. Try again in a few minutes.',
  rate_limited: 'Too many bids too fast. Slow down and try again.',
  conflict: 'That bid id was already used with a different amount. Send a new bid id.',
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
  const live = new Map<string, { expiresAt: number; src: string; keyed?: true; keyId?: string }>();
  const keyedMax = opts.keyedMax ?? 3;
  const keyedPerHour = opts.keyedPerHour ?? KEYED_PER_HOUR;
  const registry =
    opts.keys ??
    new JudgeKeyRegistry(
      [],
      opts.judgeKey === undefined
        ? undefined
        : { key: opts.judgeKey, maxRooms: keyedMax, perHour: Math.min(20, keyedPerHour) },
    );
  let keyedStamps: number[] = [];
  /** Creates per key in the last hour: one judge's key never uses another's allowance. */
  const keyStamps = new Map<string, number[]>();
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
  /** Ended rooms whose simulated holds are still to be purged, with the time they are due. */
  const purgeDue = new Map<string, number>();
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
      const revoked = (await deps.store.getJournal(KEYS_KEY))?.value as
        | { revoked?: unknown }
        | undefined;
      if (Array.isArray(revoked?.revoked)) {
        registry.setRevoked(revoked.revoked.filter((x): x is string => typeof x === 'string'));
      }
      for (const id of await deps.store.listAuctions()) {
        const m = (await deps.store.getJournal(markerKey(id)))?.value as Marker | undefined;
        if (m !== undefined && m.expired === true && m.simPurged !== true) {
          purgeDue.set(id, (m.endedAt ?? m.expiresAt) + SIM_PURGE_GRACE_MS);
        }
        if (m !== undefined && m.expired !== true) {
          live.set(id, {
            expiresAt: m.expiresAt,
            src: 'restored',
            ...(m.keyed === true ? { keyed: true as const } : {}),
            ...(m.keyId === undefined ? {} : { keyId: m.keyId }),
          });
        }
      }
      loaded = true;
    })().catch((e: unknown) => {
      // A failed read must not stick: the next request tries again.
      loading = undefined;
      throw e;
    });
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
      { error, code: error, message: message ?? REFUSAL_TEXT[error] ?? 'Request refused' },
      retryAfterS === undefined ? {} : { 'retry-after': String(retryAfterS) },
    );
  };

  /** Rooms that use a public slot; keyed rooms have a bound of their own. */
  const publicLive = (): number => [...live.values()].filter((e) => e.keyed !== true).length;
  const keyedLive = (): number => live.size - publicLive();
  /** Live rooms of one key; rooms made before per-key keys count for the legacy key. */
  const liveOf = (keyId: string): number =>
    [...live.values()].filter((e) => e.keyed === true && (e.keyId ?? LEGACY_KEY_ID) === keyId)
      .length;

  /** Seconds until the keyed room that ends first frees its slot (at least 1). */
  const soonestKeyedExpiry = (now: number): number => {
    const ends = [...live.values()].filter((e) => e.keyed === true).map((e) => e.expiresAt);
    return ends.length === 0 ? 60 : Math.max(1, Math.ceil((Math.min(...ends) - now) / 1000));
  };

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
        const endedAt = deps.clock.now();
        await deps.store.putJournal(markerKey(id), prev.version, {
          ...value,
          expired: true,
          endedAt,
        });
        if (opts.simHolds?.purge !== undefined) purgeDue.set(id, endedAt + SIM_PURGE_GRACE_MS);
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

  /** Drops the simulated holds of ended rooms whose grace is over, and marks the room as done. */
  const purgeEnded = async (deps: HttpDeps, now: number): Promise<void> => {
    const purge = opts.simHolds?.purge;
    if (purge === undefined) {
      purgeDue.clear();
      return;
    }
    for (const [id, due] of [...purgeDue]) {
      if (due > now) continue;
      try {
        const removed = await purge(id);
        const prev = await deps.store.getJournal(markerKey(id));
        const value = prev?.value as Marker | undefined;
        if (prev !== null && value !== undefined && value.simPurged !== true) {
          await deps.store.putJournal(markerKey(id), prev.version, { ...value, simPurged: true });
        }
        purgeDue.delete(id);
        if (removed > 0) {
          audit(deps)?.info('judge room sim holds purged', {
            event: 'judge_room.sim_holds_purged',
            auctionId: id,
            removed,
          });
        }
      } catch (e) {
        // Stays due: the next sweep tries again.
        audit(deps)?.error('judge room sim hold purge failed', {
          event: 'judge_room.sim_purge_failed',
          auctionId: id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
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
        await purgeEnded(deps, deps.clock.now());
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
    let key: JudgeKeyEntry | undefined;
    if (keyed) {
      const checked = checkKey(c, tag, deps.clock.now());
      if ('refused' in checked) return checked.refused;
      key = checked.key;
    }
    if (paused) return refuse(deps, 503, 'judge_rooms_paused', 'paused', tag, 60);
    // A hammered room still holds a slot until the sweeper runs; free them before judging the cap.
    if (keyed ? keyedLive() >= keyedMax : publicLive() >= opts.maxLive) await sweep();
    const now = deps.clock.now();
    if (keyed && key !== undefined) {
      keyedStamps = withinWindow(keyedStamps, now);
      const mine = withinWindow(keyStamps.get(key.id) ?? [], now);
      keyStamps.set(key.id, mine);
      // The key's own limits first, so a judge at their own limit is told so; only then the
      // host-wide ones, which blame the sandbox and not the judge.
      if (liveOf(key.id) >= key.maxRooms) {
        return refuse(deps, 429, 'judge_key_room_cap', 'key_cap', tag, soonestKeyedExpiry(now));
      }
      if (mine.length >= key.perHour) {
        return refuse(deps, 429, 'judge_rate_limited', 'key_hourly', tag, untilFree(mine, now));
      }
      if (keyedLive() >= keyedMax) {
        return refuse(deps, 503, 'judge_host_busy', 'host_cap', tag, soonestKeyedExpiry(now));
      }
      if (keyedStamps.length >= keyedPerHour) {
        return refuse(
          deps,
          503,
          'judge_host_busy',
          'host_hourly',
          tag,
          untilFree(keyedStamps, now),
        );
      }
      keyedStamps.push(now);
      mine.push(now);
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
    live.set(auctionId, {
      expiresAt,
      src: tag,
      ...(key === undefined ? {} : { keyed: true as const, keyId: key.id }),
    });
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
        ...(key === undefined ? {} : { keyed: true as const, keyId: key.id }),
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
        // Never the key itself. The id is public; it is logged as `passId` because the logger
        // redacts any field whose name contains "key".
        via: keyed ? 'judge-pass' : 'public',
        ...(key === undefined ? {} : { passId: key.id }),
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
   * Judges the judge key on a request: the key record when it is right, otherwise the refusal.
   * A wrong key counts toward a lockout of its own (`keyGuardOf`), apart from the room code
   * guard, so key typos never block joins; a locked-out source is refused even with the right
   * key. An expired or revoked key (right secret) is refused without a strike. The key is
   * compared in constant time and never logged; only its id is.
   */
  const checkKey = (
    c: Ctx,
    tag: string,
    now: number,
  ): { key: JudgeKeyEntry } | { refused: Response } => {
    const { deps } = c;
    const guard = keyGuardOf(deps);
    const lockedFor = guard.lockedFor(tag, now);
    if (lockedFor > 0) {
      return { refused: refuse(deps, 429, 'judge_key_locked', 'key_locked', tag, lockedFor) };
    }
    const given = c.req.headers.get(JUDGE_KEY_HEADER) ?? '';
    // A blank key is a missing key, not a guess: refuse it without a strike, so a panel that
    // sends Check before a key is pasted cannot lock a shared address out.
    if (given.trim() === '')
      return { refused: refuse(deps, 401, 'judge_key_invalid', 'key_blank', tag) };
    const verdict = registry.verify(given, now);
    if (verdict.ok) return { key: verdict.key };
    if (verdict.reason === 'invalid') {
      guard.noteWrong(tag, now);
      return { refused: refuse(deps, 401, 'judge_key_invalid', 'key_wrong', tag) };
    }
    const error = verdict.reason === 'expired' ? 'judge_key_expired' : 'judge_key_revoked';
    audit(deps)?.warn('judge pass refused', {
      event: 'judge_room.key_refused',
      reason: verdict.reason,
      passId: verdict.keyId,
      src: tag,
    });
    return { refused: refuse(deps, 401, error, `key_${verdict.reason}`, tag) };
  };

  /** `POST /api/judge/key`: checks the key without creating anything, so the panel can say so. */
  const keyCheck = async (c: Ctx): Promise<Response> => {
    const { deps } = c;
    if (!opts.enabled) throw new HttpError(404, 'not_found', 'no such route');
    await load(deps);
    const tag = sourceTag(requestSources.get(c.req) ?? 'unknown');
    const checked = checkKey(c, tag, deps.clock.now());
    if ('refused' in checked) return checked.refused;
    const { key } = checked;
    audit(deps)?.info('judge pass accepted', {
      event: 'judge_room.key_ok',
      src: tag,
      via: 'judge-pass',
      passId: key.id,
    });
    return json(200, {
      ok: true,
      keyId: key.id,
      roomsMax: Math.min(key.maxRooms, keyedMax),
      roomsLive: liveOf(key.id),
      // null means the key never expires (never Infinity: JSON cannot carry it).
      expiresAt: Number.isFinite(key.expiresAt) ? new Date(key.expiresAt).toISOString() : null,
    });
  };

  /** `GET /api/judge/keys` (admin): ids, labels, limits and state of every key. No hashes. */
  const keyList = async (c: Ctx): Promise<Response> => {
    requireAdmin(c);
    await load(c.deps);
    const now = c.deps.clock.now();
    return json(200, {
      keys: registry.entries().map((k) => ({
        id: k.id,
        label: k.label,
        maxRooms: k.maxRooms,
        perHour: k.perHour,
        roomsLive: liveOf(k.id),
        revoked: registry.isRevoked(k.id),
        expired: k.expiresAt <= now,
        expiresAt: Number.isFinite(k.expiresAt) ? new Date(k.expiresAt).toISOString() : null,
      })),
    });
  };

  /** `POST /api/judge/keys/:keyId/revoke` (admin): the key is refused from now on, restart or not. */
  const keyRevoke = async (c: Ctx): Promise<Response> => {
    requireAdmin(c);
    await load(c.deps);
    const id = c.params.keyId ?? '';
    if (registry.get(id) === undefined) throw new HttpError(404, 'not_found', 'no such judge key');
    // Journal first: the revoke is durable or the call fails and memory stays as it was. One
    // retry on a version conflict (two quick revokes read the same version), re-reading the row.
    const write = async (): Promise<void> => {
      const prev = await c.deps.store.getJournal(KEYS_KEY);
      const stored = (prev?.value as { revoked?: unknown } | undefined)?.revoked;
      const ids = new Set<string>([
        ...registry.revokedIds(),
        ...(Array.isArray(stored) ? stored.filter((x): x is string => typeof x === 'string') : []),
        id,
      ]);
      await c.deps.store.putJournal(KEYS_KEY, prev?.version ?? 0, { revoked: [...ids] });
    };
    try {
      await write();
    } catch (first) {
      try {
        await write();
      } catch (second) {
        audit(c.deps)?.error('judge key revoke failed', {
          event: 'judge_room.key_revoke_failed',
          passId: id,
          error: second instanceof Error ? second.message : String(first),
        });
        throw new HttpError(503, 'store_unavailable', 'the revoke could not be saved, try again');
      }
    }
    registry.revoke(id);
    audit(c.deps)?.warn('judge key revoked', { event: 'judge_room.key_revoked', passId: id });
    return json(200, { id, revoked: true });
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
    await roomFor(deps, auctionId);
    // Any whole-dollar limit from the minimum to the room cap is fine; the presets are only
    // quick picks (FIX-78).
    if (
      !Number.isSafeInteger(body.ceilingCents) ||
      body.ceilingCents < MIN_CEILING_CENTS ||
      body.ceilingCents > opts.maxCeilingCents
    ) {
      throw new GavelError('bad_message', 'ceiling is outside the allowed range');
    }
    if (!(await sim.acceptsHolds(auctionId))) {
      throw new GavelError('closed', 'the auction no longer takes holds');
    }
    let holdId: string;
    try {
      holdId = await sim.place({
        auctionId,
        bidderId: who.bidderId,
        name: body.name,
        ceilingCents: body.ceilingCents,
      });
    } catch (e) {
      // A raise past the cap or below the minimum step answers with its hold error code.
      if (
        e instanceof HoldError &&
        (e.code === 'raise_limit_reached' || e.code === 'raise_too_small')
      ) {
        const why = `sim_hold_${e.code}`;
        const src = sourceTag(auctionId);
        return refuse(deps, HOLD_ERROR_STATUS[e.code], e.code, why, src, undefined, e.message);
      }
      throw e;
    }
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

  /**
   * `POST /api/judge/rooms/:id/bids`: a bidder session of a judge room places a bid over plain
   * HTTP, for curl and SDK clients that cannot open the socket (which needs a browser Origin).
   * It takes the very path of a socket bid (rate limit, registered check, engine), only through
   * a throwaway connection. Session tokens only; judge rooms only, anything else is `not_found`.
   */
  const placeBid = async (c: Ctx): Promise<Response> => {
    const { deps } = c;
    if (!opts.enabled) throw new HttpError(404, 'not_found', 'no such route');
    const auctionId = c.params.id ?? '';
    const who = await authenticate(c, auctionId, ['session']);
    if (who.bidderId === undefined) throw new GavelError('forbidden', 'no bidder in the session');
    const body = parseBody(BidBody, await c.body());
    await load(deps);
    const marker = (await deps.store.getJournal(markerKey(auctionId)))?.value as Marker | undefined;
    if (marker === undefined) throw new GavelError('not_found', 'no such judge room');
    if (marker.expired === true || marker.expiresAt <= deps.clock.now()) {
      return refuse(deps, 410, 'judge_room_expired', 'bid_expired', sourceTag(auctionId));
    }
    const room = await roomFor(deps, auctionId);
    const mid = body.mid ?? deps.ids.mint<'MsgId'>();
    const frames = await withConnection(
      deps,
      room,
      'bidder',
      who.sub,
      (conn) =>
        room.submitBid(conn, {
          v: 1,
          t: 'bid',
          mid,
          amount: body.amount,
          source: 'qr',
        } as Parameters<typeof room.submitBid>[1]),
      who.bidderId,
    );
    const failure = frames.find((f) => f.t === 'error');
    if (failure !== undefined) {
      const code = failure.code;
      const known =
        typeof code === 'string' && code in ERROR_TABLE
          ? (code as keyof typeof ERROR_TABLE)
          : 'internal';
      const retry =
        typeof failure.retryAfterMs === 'number'
          ? Math.ceil(failure.retryAfterMs / 1000)
          : undefined;
      return json(
        ERROR_TABLE[known].status,
        { error: known, code: known, message: REFUSAL_TEXT[known] ?? 'Bid refused' },
        retry === undefined ? {} : { 'retry-after': String(Math.max(1, retry)) },
      );
    }
    const accepted = frames.find((f) => f.t === 'bid_accepted');
    if (accepted !== undefined) {
      audit(deps)?.info('judge room bid over http', {
        event: 'judge_room.bid_http',
        auctionId,
        amount: body.amount,
      });
      return json(200, {
        accepted: true,
        mid,
        bidId: accepted.bidId,
        amount: accepted.amount,
        seq: accepted.seq,
      });
    }
    const rejected = frames.find((f) => f.t === 'bid_rejected');
    if (rejected !== undefined) {
      return json(409, {
        accepted: false,
        error: 'bid_rejected',
        mid,
        reason: rejected.reason,
        retryable: rejected.retryable === true,
      });
    }
    // The room held the bid for the bidder to confirm (low-confidence bids only; HTTP bids carry
    // no confidence, so this is not expected) or sent nothing: say so rather than guess.
    return json(202, { accepted: false, pending: true, mid });
  };

  const mount: Mount = (app: HttpApp): void => {
    appDeps = app.deps;
    codeGuardOf(app.deps, joinLimits);
    app.post(JUDGE_JOIN_PATH, judgeRoute(join));
    app.post(JUDGE_SIM_HOLD_PATH, judgeRoute(simHold));
    app.post(JUDGE_BID_PATH, judgeRoute(placeBid));
    app.get(JUDGE_KEYS_PATH, judgeRoute(keyList));
    app.post(JUDGE_KEY_REVOKE_PATH, judgeRoute(keyRevoke));
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
        ...(opts.enabled && registry.any ? { keyed: true } : {}),
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
