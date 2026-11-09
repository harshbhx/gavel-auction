import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { InMemoryLedgerStore, type LedgerStore } from '@gavel/engine';
import {
  FileKillStateStore,
  HoldService,
  MemoryHoldStore,
  MemoryJournalStore,
  MemoryKillStateStore,
  MemoryWebhookEventStore,
  PayPalGateway,
  DEFAULT_HONOR_SAFE_MS,
  PersistentKillSwitch,
  TokenManager,
  emittingAudit,
  guardGateway,
  Transport,
  WebhookVerifier,
  assertSandboxConfig,
  loadConfig as loadPaymentsConfig,
  openFileStores,
  type HoldStore,
  type JournalStore,
  type KillStateStore,
  type PaymentsGateway,
  type SettlementPayload,
  type StoredWebhook,
  type WebhookEventStore,
} from '@gavel/payments';
import {
  clientKey,
  EpochMs,
  SystemClock,
  UlidMinter,
  type AuctionConfig,
  type AuctionId,
  type BidderId,
  type Cents,
  type Jti,
  type Logger,
  type RoomStore,
} from '@gavel/shared';
import type { AuthRole } from '../auth/authorize';
import { auctioneerTokenLive } from '../auth/auctioneer-floor';
import { previousSecretWarning, secretSetFromConfig, verifyRotating } from '../auth/rotation';
import type { JtiStore } from '../auth/token';
import {
  isProductionLike,
  loadConfig,
  redactConfig,
  type LoadHooks,
  type ServerConfig,
} from '../config';
import { createExportHandler as createLedgerExportHandler } from '../admin/export';
import { createReplayBundleHandler } from '../admin/replay-bundle';
import { createExportHandler } from '../http/export';
import { createGateway } from '../host/gateway';
import { createAudioHost, AUDIO_PATH } from '../host/audio-ws';
import { createNodeWsHost, type UpgradeDenied } from '../host/node-ws';
import { chooseStt } from '../voice/stt';
import { createHealthRoutes, createVersionRoute, resolveSha } from '../http/health';
import { createMetricsRoute } from '../http/metrics';
import {
  OPS_SETTLEMENT_PATH,
  adminKeyMatches,
  createOpsRoomsHandler,
  createOpsSettlementHandler,
} from '../http/ops';
import { capsFromConfig } from '../limits/caps';
import { limitsFromConfig } from '../limits/rate-limiter';
import { createGuardedWebhookRoute } from '../http/webhook-guard';
import { SECURITY_HEADERS } from '../http/security-headers';
import { portFromService, sourceOf } from '../http/webhook';
import { boundaryFromEnv, killSelf } from './checkpoint-kill';
import { createPaymentAudit } from './payment-audit';
import { createLogger, type LogSink } from '../log/logger';
import { RateLimiter } from '../limits/rate-limiter';
import { MetricsCollector } from '../ops/metrics';
import { createLogRing } from '../obs/logring';
import { createOpsSummaryRoute, createPrometheusRoute } from '../obs/ops-summary';
import { createWarmupRoute, type WarmupStep } from '../warmup/warmup';
import { createAuctionService, type AuctionService } from '../runtime/auction-service';
import { lotIdOf } from '../runtime/ledger-engine';
import { FileLedgerStore } from '../store/file-ledger-store';
import { CORS_EXPOSE, createHttpApp } from '../http/app';
import { createDemoHandler, DEMO_RESET_PATH, DEMO_ROOMS_PATH, DEMO_SEED_PATH } from '../http/demo';
import { createDemoHoldSource } from '../http/demo-holds';
import { createSimHoldSource, purgeSimHolds, withSimulatedHolds } from '../http/sim-holds';
import { mountAuctions } from '../http/auctions';
import { allowedOriginsOf, isOriginAllowed } from '../http/origins';
import { JudgeKeyRegistry, parseJudgeKeys } from '../auth/judge-keys';
import { createJudgeRooms, JUDGE_ROOM_DEFAULTS } from '../http/judge-rooms';
import { mountAuctioneerToken } from '../http/auctioneer-token';
import { mountControl } from '../http/control';
import { mountHolds } from '../http/holds';
import { mountInvites } from '../http/invites';
import { nodeRoutesFor, requestSources } from '../http/node-bridge';
import { mountRead } from '../http/read';
import { mountReceipt } from '../http/receipt';
import { acquireDataDirLock } from '../store/data-dir-lock';
import { FileRoomStore } from '../store/file-room-store';
import { migrate, PostgresStore } from '../store/postgres';
import { RoomJournalStore } from '../store/room-journal-store';
import { MemoryStore } from '../store/memory-store';

export const WEBHOOK_PATH = '/webhooks/paypal';
const EXPORT_PATH = /^\/api\/auctions\/([^/]+)\/export\/?$/;
/** R-RT-120: most sockets one source address may hold open at once. */
const MAX_SOCKETS_PER_SOURCE = 20;
/** Wait a device refused by the socket cap is told to keep before it tries again. */
const SOCKET_CAP_RETRY_MS = 10_000;
/** Refusals one address may receive over the socket per minute before a bare 429. */
const MAX_DENIALS_PER_MINUTE = 120;

/** Counts refusals per source in a fixed one-minute window. */
class DenialWindow {
  private readonly windows = new Map<string, { until: number; n: number }>();
  /** True while this source is still inside its refusal allowance. */
  take(source: string, nowMs: number): boolean {
    if (this.windows.size > 5000) {
      for (const [key, w] of this.windows) if (w.until <= nowMs) this.windows.delete(key);
    }
    const w = this.windows.get(source);
    if (w === undefined || w.until <= nowMs) {
      this.windows.set(source, { until: nowMs + 60_000, n: 1 });
      return true;
    }
    w.n += 1;
    return w.n <= MAX_DENIALS_PER_MINUTE;
  }
}

type Env = Readonly<Record<string, string | undefined>>;

/** A route the host adds on top of the built-in ones; returns true when it answered. */
export type ExtraRoutes = (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;

const DEMO_PATHS: readonly string[] = [DEMO_RESET_PATH, DEMO_SEED_PATH, DEMO_ROOMS_PATH];

function demoRoutesFor(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
): ExtraRoutes {
  return async (req, res) => {
    const path = (req.url ?? '').split('?')[0] ?? '';
    if (!DEMO_PATHS.includes(path)) return false;
    await handler(req, res);
    return true;
  };
}

/** Scripted demo lot: ten minutes from creation, whole-cent amounts. */
function demoAuctionConfig(nowMs: number): AuctionConfig {
  return {
    mode: 'english',
    currency: 'USD',
    reserve: 10_000 as Cents,
    minIncrement: 500 as Cents,
    endTs: EpochMs(nowMs + 600_000),
    softCloseWindowMs: 30_000,
    softCloseExtensionMs: 30_000,
    maxExtensions: 5,
    ceilingPresets: [30_000 as Cents, 50_000 as Cents],
    confirmConfidenceThreshold: 0.85,
  };
}

export interface ComposeOptions {
  /** Where log lines go. Default: standard output. */
  sink?: LogSink;
  /** Called instead of exiting when the configuration is invalid (tests). */
  hooks?: LoadHooks;
  /** More routes, tried after the built-in ones and before the 404 (the auction HTTP app). */
  extraRoutes?: (service: AuctionService, store: RoomStore) => ExtraRoutes;
  /** Receives every settlement payload and its canonical JSON (tests, a future feed). */
  onSettlementPayload?: (payload: SettlementPayload, json: string) => Promise<void> | void;
  /** Clock for the /warmup report (tests). Default: Date.now. */
  warmupNow?: () => number;
  /** Warmup time budget in ms (tests). Default: WARMUP_BUDGET_MS. */
  warmupBudgetMs?: number;
  /** More warmup steps next to the built-in ones (tests). */
  warmupSteps?: readonly WarmupStep[];
}

export interface Composed {
  config: ServerConfig;
  service: AuctionService;
  store: RoomStore;
  /** The node http server. Not listening yet; call `listen`. */
  http: Server;
  /** Starts listening on PORT (or the given port; 0 picks a free one) and returns the port. */
  listen(port?: number): Promise<number>;
  /**
   * Stops accepting, lets in-flight requests finish (idle keep-alive sockets are closed at
   * once, the rest after `graceMs`, default 5000), waits for settlement runs, then stops the
   * service and the in-process fake PayPal, if any.
   */
  close(graceMs?: number): Promise<void>;
}

interface PaymentsWiring {
  gateway: PaymentsGateway;
  verifier: WebhookVerifier;
  /** GAVEL_HOLD_MAX_AGE_MS, validated in both modes (R-PAY-005). */
  holdMaxAgeMs: number;
  /** GAVEL_MAX_CEILING_CENTS, validated in both modes. */
  maxCeilingCents: number;
  /** Fetches or reuses the PayPal access token so the first real call is fast. */
  warmToken(): Promise<void>;
  stop(): Promise<void>;
}

/** The gateway and webhook verifier for the selected mode (R-QA-043, R-PAY-002). */
async function wirePayments(
  config: ServerConfig,
  env: Env,
  clock: SystemClock,
): Promise<PaymentsWiring> {
  const payClock = { nowMs: (): number => clock.now() };
  const limits = loadPaymentsConfig(
    { ...env, PAYPAL_ENV: config.PAYPAL_ENV },
    { fake: config.PAYMENTS === 'fake' },
  );
  const { holdMaxAgeMs, maxCeilingCents } = limits;
  if (config.PAYMENTS === 'fake') {
    const { FakePayPalServer, DEFAULT_FAKE_WEBHOOK_ID } = await import('@gavel/payments/fake');
    const paypal = new FakePayPalServer({ webhookId: DEFAULT_FAKE_WEBHOOK_ID });
    await paypal.start();
    const auth = new TokenManager({
      transport: new Transport(),
      baseUrl: paypal.url,
      clientId: 'fake-client',
      clientSecret: 'fake-secret',
    });
    return {
      gateway: new PayPalGateway({ auth, fake: true, clock: payClock }),
      verifier: new WebhookVerifier({ auth, webhookId: DEFAULT_FAKE_WEBHOOK_ID, fake: true }),
      holdMaxAgeMs,
      maxCeilingCents,
      warmToken: async () => void (await auth.getToken()),
      stop: () => paypal.stop(),
    };
  }
  const pay = loadPaymentsConfig({ ...env, PAYPAL_ENV: config.PAYPAL_ENV }, { fake: false });
  assertSandboxConfig(pay);
  const auth = new TokenManager({
    transport: new Transport(),
    baseUrl: pay.baseUrl,
    clientId: pay.clientId,
    clientSecret: pay.clientSecret,
  });
  return {
    gateway: new PayPalGateway({ auth, fake: false, clock: payClock }),
    verifier: new WebhookVerifier({ auth, webhookId: pay.webhookId, fake: false }),
    holdMaxAgeMs,
    maxCeilingCents,
    warmToken: async () => void (await auth.getToken()),
    stop: () => Promise.resolve(),
  };
}

interface Stores {
  room: RoomStore;
  ledger: LedgerStore;
  journals: JournalStore;
  holds: HoldStore;
  webhookEvents: WebhookEventStore;
  kill: KillStateStore;
  /** Frees the data directory lock, if one was taken. */
  release(): void;
}

async function openStores(config: ServerConfig, clock: SystemClock): Promise<Stores> {
  const now = (): number => clock.now();
  switch (config.STORE) {
    case 'memory':
      return {
        room: new MemoryStore(now),
        ledger: new InMemoryLedgerStore(),
        journals: new MemoryJournalStore(),
        holds: new MemoryHoldStore(),
        webhookEvents: new MemoryWebhookEventStore(),
        kill: new MemoryKillStateStore(),
        release: () => undefined,
      };
    case 'file':
    case 'postgres': {
      const dir = config.DATA_DIR;
      mkdirSync(dir, { recursive: true });
      const lock = acquireDataDirLock(dir);
      let pool: { end: () => Promise<void> } | undefined;
      try {
        const pay = openFileStores(join(dir, 'payments'));
        let room: RoomStore;
        let journals: JournalStore;
        let closeRoom = (): void => undefined;
        if (config.STORE === 'postgres') {
          // The room log, snapshots, token denylist and payment journals live in Postgres. The
          // ledgers, holds, webhook ids and kill switch stay in the data directory, which this
          // host locks, so one host owns them.
          const { default: pg } = await import('pg');
          const url = config.DATABASE_URL;
          if (url === undefined) throw new Error('DATABASE_URL is required when STORE=postgres');
          const p = new pg.Pool({ connectionString: url });
          pool = p;
          await migrate(p);
          const pgStore = new PostgresStore(p, now);
          room = pgStore;
          journals = new RoomJournalStore(pgStore);
        } else {
          const fileRoom = await FileRoomStore.open(join(dir, 'rooms.jsonl'), now);
          room = fileRoom;
          journals = pay.journals;
          closeRoom = () => fileRoom.close();
        }
        return {
          room,
          ledger: new FileLedgerStore(join(dir, 'ledgers')),
          journals,
          holds: pay.holds,
          webhookEvents: pay.webhooks,
          kill: new FileKillStateStore(join(dir, 'kill-switch.json')),
          release: () => {
            try {
              closeRoom();
              if (pool !== undefined) void pool.end().catch(() => undefined);
            } finally {
              lock.release();
            }
          },
        };
      } catch (e) {
        if (pool !== undefined) void pool.end().catch(() => undefined);
        lock.release();
        throw e;
      }
    }
    default:
      throw new Error(
        `STORE=${config.STORE} is not available in this build; use memory, file or postgres`,
      );
  }
}

/** Revocations come from the room store's denylist; auctioneer tokens are not single use. */
function revocationsOf(store: { isDenied(jti: Jti): Promise<boolean> }): JtiStore {
  return {
    isRevoked: (jti) => store.isDenied(jti as Jti),
    consume: () => Promise.resolve(true),
  };
}

function bearerOf(req: IncomingMessage): string | undefined {
  const h = req.headers.authorization;
  if (typeof h !== 'string') return undefined;
  const m = /^Bearer (\S+)$/.exec(h);
  return m?.[1];
}

/** Origins that may open a socket: the configured CORS list plus the public origin. */
/** The origin links are built on: WEB_ORIGIN, else the first CORS origin, else the API host. */
export function webOriginOf(config: {
  PUBLIC_URL: string;
  CORS_ORIGINS: readonly string[];
  WEB_ORIGIN?: string | undefined;
}): string {
  const first = config.CORS_ORIGINS[0];
  const raw = config.WEB_ORIGIN ?? first ?? config.PUBLIC_URL;
  try {
    return new URL(raw).origin;
  } catch {
    return config.PUBLIC_URL.replace(/\/+$/, '');
  }
}

/** The one allow-list of the host: CORS_ORIGINS, the web origin and the API's own origin. */
export function allowedOriginsFor(config: {
  PUBLIC_URL: string;
  CORS_ORIGINS: readonly string[];
  WEB_ORIGIN?: string | undefined;
}): string[] {
  return allowedOriginsOf({
    corsOrigins: config.CORS_ORIGINS,
    webOrigin: config.WEB_ORIGIN,
    publicUrl: config.PUBLIC_URL,
  });
}

/**
 * The gateway the hold routes get: orders, order reads, authorization and the void of an
 * abandoned hold, all behind the kill switch. Capture and reauthorization stay with the
 * settlement saga; a hold route that tried either would fail here before reaching PayPal.
 */
function holdRouteGateway(gateway: PaymentsGateway): PaymentsGateway {
  const settlementOnly = (op: string): Promise<never> =>
    Promise.reject(new Error(`${op} runs only in the settlement saga`));
  return {
    createOrder: (i) => gateway.createOrder(i),
    getOrder: (id) => gateway.getOrder(id),
    authorizeOrder: (id, requestId) => gateway.authorizeOrder(id, requestId),
    getHoldTruth: (h) => gateway.getHoldTruth(h),
    voidAuthorization: (authId, requestId) => gateway.voidAuthorization(authId, requestId),
    capture: () => settlementOnly('capture'),
    reauthorize: () => settlementOnly('reauthorize'),
  };
}

function notFound(res: ServerResponse): void {
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end('{"error":"not_found"}');
}

/**
 * Builds the whole server from an environment map: config, stores, PayPal gateway and webhook
 * verifier, the auction service and the HTTP routes that exist today (health, metrics, webhook,
 * export). It does not listen until `listen` is called (R-RT-001, R-QA-059).
 */
export async function composeServer(env: Env, opts: ComposeOptions = {}): Promise<Composed> {
  const config = opts.hooks ? loadConfig(env, opts.hooks) : loadConfig(env);
  const clock = new SystemClock();
  const logRing = createLogRing(opts.sink ?? ((line) => void process.stdout.write(`${line}\n`)));
  const log: Logger = createLogger({
    clock,
    sink: logRing.write,
    level: config.LOG_LEVEL,
  });
  const ids = new UlidMinter(clock);
  const stores = await openStores(config, clock);
  let payments: PaymentsWiring;
  try {
    payments = await wirePayments(config, env, clock);
  } catch (e) {
    stores.release();
    throw e;
  }
  const baseAudit = createPaymentAudit({
    clock,
    sink: opts.sink ?? ((line) => void process.stdout.write(`${line}\n`)),
    file:
      config.STORE === 'file' || config.STORE === 'postgres'
        ? join(config.DATA_DIR, 'payment-audit.jsonl')
        : undefined,
  });
  // Every audit entry also yields its wire payload (a settlement_update per state change).
  const audit = emittingAudit({
    journals: stores.journals,
    inner: baseAudit,
    publish: (payload, json) => {
      if (opts.onSettlementPayload !== undefined) return opts.onSettlementPayload(payload, json);
      if (payload.type === 'settlement_update') {
        log.debug('settlement update', { auctionId: payload.auctionId, state: payload.state });
      }
      return undefined;
    },
  });
  const killSwitch = new PersistentKillSwitch({
    store: stores.kill,
    audit,
    clock: { nowMs: () => clock.now() },
  });
  let serviceStats = (): { rooms: number; connections: number; mailboxDepth: number } => ({
    rooms: 0,
    connections: 0,
    mailboxDepth: 0,
  });
  const metrics = new MetricsCollector({
    connections: () => serviceStats().connections,
    rooms: () => serviceStats().rooms,
    mailboxDepth: () => serviceStats().mailboxDepth,
  });
  const limiter = new RateLimiter(clock, limitsFromConfig(config));
  const boundary = boundaryFromEnv(env, killSelf, config);
  const service = createAuctionService({
    ...(boundary === undefined ? {} : { boundary }),
    roomMetrics: metrics,
    limiter,
    caps: capsFromConfig(config),
    store: stores.room,
    clock,
    ids,
    ledger: stores.ledger,
    journals: stores.journals,
    holds: stores.holds,
    webhookEvents: stores.webhookEvents,
    audit,
    gateway:
      config.JUDGE_ROOMS && config.JUDGE_SIM_HOLDS
        ? withSimulatedHolds(payments.gateway, () => clock.now())
        : payments.gateway,
    verifier: payments.verifier,
    killSwitch,
    holdMaxAgeMs: payments.holdMaxAgeMs,
    ...(config.GAVEL_RECONCILE_INTERVAL_MS !== undefined && config.GAVEL_RECONCILE_INTERVAL_MS > 0
      ? { reconcileIntervalMs: config.GAVEL_RECONCILE_INTERVAL_MS }
      : {}),
    reconcileRepair: config.GAVEL_RECONCILE_REPAIR,
    reauthPolicy: {
      enabled: config.GAVEL_REAUTH,
      honorSafeMs: config.GAVEL_REAUTH_HONOR_SAFE_MS ?? DEFAULT_HONOR_SAFE_MS,
    },
    maxCeilingCents: payments.maxCeilingCents,
    onError: (auctionId, error) =>
      log.error('settlement stopped', {
        auctionId,
        error: error instanceof Error ? error.message : String(error),
      }),
  });
  serviceStats = () => service.stats();
  await service.resume();
  log.info('server composed', redactConfig(config));

  const health = createHealthRoutes({
    pingStore: async () => {
      await stores.room.ping();
    },
    migrationsApplied: () => true,
  });
  const baseSecrets = secretSetFromConfig(config);
  const secrets = {
    ...baseSecrets,
    onPreviousUse: () => {
      metrics.previousSecretUse();
      log.warn('token verified under TOKEN_SECRET_PREVIOUS');
    },
  };
  const prevWarning = previousSecretWarning(secrets, clock.now());
  if (prevWarning !== undefined) log.warn(prevWarning);
  const exportRoute = createExportHandler({
    store: stores.room,
    authenticate: async (req, auctionId): Promise<AuthRole | undefined> => {
      if (adminKeyMatches(req, config.ADMIN_KEY)) return 'admin';
      const token = bearerOf(req);
      if (token === undefined) return undefined;
      const result = await verifyRotating(token, secrets, {
        aud: auctionId,
        kinds: ['auctioneer'],
        nowMs: clock.now(),
        jtis: revocationsOf(stores.room),
      });
      if (!result.ok) return undefined;
      return (await auctioneerTokenLive(stores.room, result.payload)) ? 'auctioneer' : undefined;
    },
  });
  const replayBundleRoute = createReplayBundleHandler({
    adminKey: config.ADMIN_KEY,
    ledger: stores.ledger,
    now: () => clock.now(),
  });
  const ledgerExportRoute = createLedgerExportHandler({
    adminKey: config.ADMIN_KEY,
    ledger: stores.ledger,
    listAuctions: () => stores.room.listAuctions(),
    payments: {
      journal: (id) => stores.journals.load(id),
      holds: (id) => stores.holds.listByAuction(id),
      webhooks: async () => {
        const snap = (
          stores.webhookEvents as { snapshot?: () => { events: Record<string, StoredWebhook> } }
        ).snapshot;
        if (snap === undefined) throw new Error('webhook store cannot be listed');
        return Object.values(snap.call(stores.webhookEvents).events);
      },
      kill: () => stores.kill.load(),
    },
    roomLog: (id, from, limit) => stores.room.readEvents(id as AuctionId, from, limit),
  });
  const webhookRoute = createGuardedWebhookRoute(portFromService(service), {
    trustedProxyHops: config.TRUSTED_PROXY_HOPS,
    log: {
      info: (m, f) => log.info(m, f),
      warn: (m, f) => log.warn(m, f),
    },
    metrics,
    knownAuction: async (id) => (await stores.room.listAuctions()).includes(id as AuctionId),
  });
  const opsRoomsRoute = createOpsRoomsHandler({
    adminKey: config.ADMIN_KEY,
    rooms: () => service.opsRooms(),
  });
  const opsSettlementRoute = createOpsSettlementHandler({
    adminKey: config.ADMIN_KEY,
    exists: async (id) => (await stores.room.listAuctions()).includes(id as AuctionId),
    hasSettlement: async (id) => (await stores.journals.load(lotIdOf(id as AuctionId))) !== null,
    voidAll: (id, actor) => service.voidAll(id as AuctionId, actor),
    releaseReviewHolds: (id, actor) => service.releaseReviewHolds(id as AuctionId, actor),
  });
  const metricsRoute = createMetricsRoute(metrics, { adminKey: config.ADMIN_KEY });
  const warmupRoute = createWarmupRoute({
    steps: [
      { name: 'database', run: () => stores.room.ping() },
      { name: 'paypal-token', run: () => payments.warmToken() },
      {
        name: 'demo-auction',
        run: async () => {
          await stores.room.listAuctions();
          service.opsRooms();
        },
      },
      ...(opts.warmupSteps ?? []),
    ],
    ...(opts.warmupNow !== undefined ? { now: opts.warmupNow } : {}),
    ...(opts.warmupBudgetMs !== undefined ? { budgetMs: opts.warmupBudgetMs } : {}),
  });
  const opsSummaryRoute = createOpsSummaryRoute({
    adminKey: config.ADMIN_KEY,
    logs: () => logRing.lines(),
    sagas: () =>
      service.opsRooms().map((r) => ({ auctionId: r.auctionId, lotId: '-', state: r.status })),
    metrics: () => metrics.snapshot(),
  });
  const prometheusRoute = createPrometheusRoute({
    adminKey: config.ADMIN_KEY,
    metrics: () => metrics.snapshot(),
  });
  // The web approval flow (R-PAY-030, issue 1074): the same hold store, audit sink and kill
  // switch as the settlement, so every PayPal call is audited and refused while payments are
  // paused; the bidder always comes from the session token.
  const holdService = new HoldService({
    gateway: holdRouteGateway(guardGateway(payments.gateway, killSwitch)),
    holds: stores.holds,
    audit,
    clock: { nowMs: () => clock.now() },
    maxCeilingCents: payments.maxCeilingCents,
  });
  // JUDGE_KEYS: one bad entry is skipped and logged (never its hash), the rest still work.
  const parsedKeys = parseJudgeKeys(config.JUDGE_KEYS);
  for (const problem of parsedKeys.problems) {
    log.error('JUDGE_KEYS entry skipped', { event: 'judge_keys.entry_skipped', problem });
  }
  for (const e of parsedKeys.entries) {
    if (e.maxRooms > config.JUDGE_KEY_ROOMS_MAX) {
      log.warn('judge key allows more rooms than the host', {
        event: 'judge_keys.limit_above_host',
        passId: e.id,
        maxRooms: e.maxRooms,
        hostMax: config.JUDGE_KEY_ROOMS_MAX,
      });
    }
  }
  const judgeKeyEntries = parsedKeys.entries;
  // Cached transcripts unless VOICE_STT names a live provider whose key is set (no key needed).
  const stt = chooseStt(
    {
      VOICE_STT: config.VOICE_STT,
      GROQ_API_KEY: env['GROQ_API_KEY'],
      DEEPGRAM_API_KEY: env['DEEPGRAM_API_KEY'],
    },
    { log: (message, fields) => log.warn(message, fields) },
  );
  // Judge rooms (R-JRM): key-less real sandbox rooms behind JUDGE_ROOMS=1; config refuses the
  // flag with live PayPal. The create route is mounted always and answers 404 while it is off.
  const judgeRooms = createJudgeRooms({
    voiceLive: () => stt.name === 'groq' || stt.name === 'deepgram',
    enabled: config.JUDGE_ROOMS,
    paused: config.JUDGE_ROOMS_PAUSED,
    maxLive: config.JUDGE_ROOMS_MAX,
    ttlMs: config.JUDGE_ROOM_TTL_MS,
    perIpPerHour: config.JUDGE_ROOMS_PER_IP_HOUR,
    globalPerHour: config.JUDGE_ROOMS_PER_HOUR,
    maxCeilingCents: payments.maxCeilingCents,
    lotWindowMs: JUDGE_ROOM_DEFAULTS.lotWindowMs,
    keyedMax: config.JUDGE_KEY_ROOMS_MAX,
    keyedPerHour: config.JUDGE_KEY_CREATES_PER_HOUR,
    ledger: stores.ledger,
    // Per-judge keys plus the legacy shared JUDGE_KEY as one more entry (id "legacy").
    keys: new JudgeKeyRegistry(
      judgeKeyEntries,
      config.JUDGE_KEY === undefined
        ? undefined
        : {
            key: config.JUDGE_KEY,
            maxRooms: Math.min(config.JUDGE_KEY_ROOMS_MAX, 3),
            perHour: 20,
          },
    ),
    ...(config.JUDGE_ROOMS && config.JUDGE_SIM_HOLDS
      ? {
          simHolds: {
            acceptsHolds: (auctionId: string) => service.acceptsHolds(auctionId as AuctionId),
            place: async (input) => {
              const holdId = await createSimHoldSource(stores.holds, () => clock.now())(
                input.bidderId as BidderId,
                input.ceilingCents as Cents,
                input.auctionId as AuctionId,
              );
              await service.registerBidder({
                auctionId: input.auctionId as AuctionId,
                bidderId: input.bidderId as BidderId,
                holdId,
                name: input.name,
              });
              await service.holdApproved(holdId);
              return holdId;
            },
            purge: (auctionId: string) => purgeSimHolds(stores.holds, auctionId),
          },
        }
      : {}),
  });
  const apiApp = createHttpApp(
    {
      service,
      store: stores.room,
      clock,
      ids,
      secrets,
      adminKey: config.ADMIN_KEY,
      publicUrl: config.PUBLIC_URL,
      webOrigin: webOriginOf(config),
      corsOrigins: config.CORS_ORIGINS,
      docsOrigins: config.JUDGE_DOCS_ORIGINS,
      log,
      joinLimit: (req) => limiter.checkJoin(requestSources.get(req) ?? 'unknown'),
    },
    [
      mountAuctions,
      mountInvites,
      mountRead,
      mountReceipt,
      mountControl,
      mountAuctioneerToken,
      judgeRooms.mount,
      mountHolds({
        service: holdService,
        store: stores.holds,
        acceptsHolds: (auctionId) => service.acceptsHolds(auctionId as AuctionId),
        registerBidder: (input) =>
          service.registerBidder({
            auctionId: input.auctionId as AuctionId,
            bidderId: input.bidderId as BidderId,
            holdId: input.holdId,
            name: input.name,
          }),
        approved: (holdId) => service.holdApproved(holdId),
      }),
    ],
  );
  judgeRooms.start();
  const apiRoutes = nodeRoutesFor(apiApp, config.PUBLIC_URL, (req) =>
    sourceOf(req, config.TRUSTED_PROXY_HOPS),
  );
  const hostExtra = opts.extraRoutes?.(service, stores.room);
  // Demo routes exist only with DEMO_MODE=1 on the fake payments adapter; config refuses the
  // flag under production-like settings, and the handler checks that again per request.
  const demoRoutes: ExtraRoutes | undefined =
    config.DEMO_MODE && config.PAYMENTS === 'fake'
      ? demoRoutesFor(
          createDemoHandler({
            enabled: true,
            production: isProductionLike(config),
            adminKey: config.ADMIN_KEY,
            ids,
            service,
            config: () => demoAuctionConfig(clock.now()),
            auctioneerSub: 'demo-auctioneer',
            holdFor: createDemoHoldSource(stores.holds, () => clock.now()),
            maxRooms: config.DEMO_MAX_ROOMS,
          }),
        )
      : undefined;
  const extra: ExtraRoutes = async (req, res) =>
    (demoRoutes !== undefined && (await demoRoutes(req, res))) ||
    (await apiRoutes(req, res)) ||
    (hostExtra !== undefined && (await hostExtra(req, res)));
  const versionRoute = createVersionRoute(resolveSha(env));

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const path = (req.url ?? '').split('?')[0] ?? '';
    // Liveness probes come from the platform, not a client: never limit them.
    if (path === '/healthz') return health.healthz(req, res);
    if (path === '/readyz') return health.readyz(req, res);
    if (path === '/version') return versionRoute(req, res);
    // R-RT-120: per-client HTTP limit; webhook routes are exempt inside checkHttp.
    const limited = limiter.checkHttp(
      sourceOf(req, config.TRUSTED_PROXY_HOPS) ?? 'unknown',
      path,
      req.method,
    );
    if (!limited.ok) {
      res.writeHead(429, {
        'content-type': 'application/json',
        'retry-after': String(Math.max(1, Math.ceil(limited.retryAfterMs / 1000))),
      });
      res.end('{"error":"rate_limited"}');
      return;
    }
    if (path === '/admin/export') return ledgerExportRoute(req, res);
    if (path === '/admin/replay-bundle') return replayBundleRoute(req, res);
    if (path === '/warmup') return warmupRoute(req, res);
    if (path === '/metrics') return metricsRoute(req, res);
    if (path === '/metrics/prometheus') return prometheusRoute(req, res);
    if (path === '/ops/summary') return opsSummaryRoute(req, res);
    if (path === '/ops/rooms') return opsRoomsRoute(req, res);
    if (OPS_SETTLEMENT_PATH.test(path)) return opsSettlementRoute(req, res, path);
    if (path === WEBHOOK_PATH) return webhookRoute(req, res);
    if (EXPORT_PATH.test(path)) return exportRoute(req, res);
    if (await extra(req, res)) return;
    notFound(res);
  };
  const allowedOrigins = allowedOriginsFor(config);
  /** R-RT-120: open sockets per source address, released on close. */
  const socketsBySource = new Map<string, number>();
  const http = createServer((req, res) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    // Early answers (429, 404, 500) never reach the app, so give them the CORS headers a
    // browser needs to read the status instead of reporting a network error.
    const origin = req.headers.origin;
    if (isOriginAllowed(allowedOrigins, origin)) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('access-control-expose-headers', CORS_EXPOSE);
      res.setHeader('vary', 'Origin');
    }
    if (wsHost.handleRequest(req, res)) return;
    handle(req, res).catch((error: unknown) => {
      log.error('request failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end('{"error":"internal"}');
      } else res.destroy();
    });
  });

  const denials = new DenialWindow();
  const admitUpgrade = (req: IncomingMessage): (() => void) | UpgradeDenied | undefined => {
    const source = clientKey(sourceOf(req, config.TRUSTED_PROXY_HOPS) ?? 'unknown');
    const open = socketsBySource.get(source) ?? 0;
    const refusal = ((): UpgradeDenied | undefined => {
      const joined = limiter.checkJoin(source);
      if (!joined.ok) return { deny: { retryAfterMs: joined.retryAfterMs } };
      // A per-address cap: the refused device is told to wait (4429), not to give up.
      if (open >= MAX_SOCKETS_PER_SOURCE) return { deny: { retryAfterMs: SOCKET_CAP_RETRY_MS } };
      return undefined;
    })();
    if (refusal !== undefined) {
      // Past the hard cap of refusals per minute the answer is a bare HTTP 429 again, so a flood
      // does not get a handshake each.
      return denials.take(source, clock.now()) ? refusal : undefined;
    }
    socketsBySource.set(source, open + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = (socketsBySource.get(source) ?? 1) - 1;
      if (left <= 0) socketsBySource.delete(source);
      else socketsBySource.set(source, left);
    };
  };
  const wsHost = createNodeWsHost({
    server: http,
    clock,
    allowedOrigins: allowedOriginsFor(config),
    passPaths: [AUDIO_PATH],
    admitUpgrade,
    accept: createGateway({
      service,
      store: stores.room,
      clock,
      ids,
      secrets,
      limiter,
    }),
  });

  const audioHost = createAudioHost({
    server: http,
    clock,
    allowedOrigins: allowedOriginsFor(config),
    secrets,
    store: stores.room,
    service,
    makeStt: stt.make,
    // The audio socket has no client that reads a refusal frame: a denial stays a bare 429.
    admitUpgrade: (req) => {
      const admitted = admitUpgrade(req);
      return typeof admitted === 'object' ? undefined : admitted;
    },
    log: (message, fields) => log.warn(message, fields),
  });

  return {
    config,
    service,
    store: stores.room,
    http,
    listen: (port = config.PORT) =>
      new Promise<number>((resolve, reject) => {
        http.once('error', reject);
        http.listen(port, () => {
          http.off('error', reject);
          const addr = http.address();
          resolve(typeof addr === 'object' && addr !== null ? addr.port : port);
        });
      }),
    close: async (graceMs = 5000) => {
      judgeRooms.stop();
      await audioHost.close();
      await wsHost.close();
      await new Promise<void>((resolve) => {
        if (!http.listening) return resolve();
        http.close(() => resolve());
        http.closeIdleConnections();
        const force = setTimeout(() => http.closeAllConnections(), graceMs);
        force.unref();
        http.once('close', () => clearTimeout(force));
      });
      const errors: unknown[] = [];
      for (const step of [() => service.close(), () => payments.stop(), () => stores.release()]) {
        try {
          await step();
        } catch (e) {
          errors.push(e);
        }
      }
      if (errors.length > 0) throw errors[0];
    },
  };
}
