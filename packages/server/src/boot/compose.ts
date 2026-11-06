import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { InMemoryLedgerStore, type LedgerStore } from '@gavel/engine';
import {
  FileKillStateStore,
  MemoryHoldStore,
  MemoryJournalStore,
  MemoryKillStateStore,
  MemoryWebhookEventStore,
  PayPalGateway,
  PersistentKillSwitch,
  TokenManager,
  Transport,
  WebhookVerifier,
  assertSandboxConfig,
  loadConfig as loadPaymentsConfig,
  openFileStores,
  type HoldStore,
  type JournalStore,
  type KillStateStore,
  type PaymentsGateway,
  type WebhookEventStore,
} from '@gavel/payments';
import {
  SystemClock,
  UlidMinter,
  type AuctionId,
  type Jti,
  type Logger,
  type RoomStore,
} from '@gavel/shared';
import type { AuthRole } from '../auth/authorize';
import { auctioneerTokenLive } from '../auth/auctioneer-floor';
import { previousSecretWarning, secretSetFromConfig, verifyRotating } from '../auth/rotation';
import type { JtiStore } from '../auth/token';
import { loadConfig, redactConfig, type LoadHooks, type ServerConfig } from '../config';
import { createExportHandler as createLedgerExportHandler } from '../admin/export';
import { createReplayBundleHandler } from '../admin/replay-bundle';
import { createExportHandler } from '../http/export';
import { createGateway } from '../host/gateway';
import { createNodeWsHost } from '../host/node-ws';
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
import { createHttpApp } from '../http/app';
import { mountAuctions } from '../http/auctions';
import { mountAuctioneerToken } from '../http/auctioneer-token';
import { mountControl } from '../http/control';
import { mountInvites } from '../http/invites';
import { nodeRoutesFor } from '../http/node-bridge';
import { mountRead } from '../http/read';
import { acquireDataDirLock } from '../store/data-dir-lock';
import { FileRoomStore } from '../store/file-room-store';
import { MemoryStore } from '../store/memory-store';

export const WEBHOOK_PATH = '/webhooks/paypal';
const EXPORT_PATH = /^\/api\/auctions\/([^/]+)\/export\/?$/;
/** R-RT-120: most sockets one source address may hold open at once. */
const MAX_SOCKETS_PER_SOURCE = 20;

type Env = Readonly<Record<string, string | undefined>>;

/** A route the host adds on top of the built-in ones; returns true when it answered. */
export type ExtraRoutes = (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;

export interface ComposeOptions {
  /** Where log lines go. Default: standard output. */
  sink?: LogSink;
  /** Called instead of exiting when the configuration is invalid (tests). */
  hooks?: LoadHooks;
  /** More routes, tried after the built-in ones and before the 404 (the auction HTTP app). */
  extraRoutes?: (service: AuctionService, store: RoomStore) => ExtraRoutes;
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
    case 'file': {
      const dir = config.DATA_DIR;
      mkdirSync(dir, { recursive: true });
      const lock = acquireDataDirLock(dir);
      try {
        const pay = openFileStores(join(dir, 'payments'));
        const room = await FileRoomStore.open(join(dir, 'rooms.jsonl'), now);
        return {
          room,
          ledger: new FileLedgerStore(join(dir, 'ledgers')),
          journals: pay.journals,
          holds: pay.holds,
          webhookEvents: pay.webhooks,
          kill: new FileKillStateStore(join(dir, 'kill-switch.json')),
          release: () => {
            try {
              room.close();
            } finally {
              lock.release();
            }
          },
        };
      } catch (e) {
        lock.release();
        throw e;
      }
    }
    default:
      throw new Error(`STORE=${config.STORE} is not available in this build; use memory or file`);
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
function wsOrigins(config: { PUBLIC_URL: string; CORS_ORIGINS: readonly string[] }): string[] {
  return [...new Set([new URL(config.PUBLIC_URL).origin, ...config.CORS_ORIGINS])];
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
  const audit = createPaymentAudit({
    clock,
    sink: opts.sink ?? ((line) => void process.stdout.write(`${line}\n`)),
    file: config.STORE === 'file' ? join(config.DATA_DIR, 'payment-audit.jsonl') : undefined,
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
  const boundary = boundaryFromEnv(env, killSelf);
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
    gateway: payments.gateway,
    verifier: payments.verifier,
    killSwitch,
    holdMaxAgeMs: payments.holdMaxAgeMs,
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
  const apiApp = createHttpApp(
    {
      service,
      store: stores.room,
      clock,
      ids,
      secrets,
      adminKey: config.ADMIN_KEY,
      publicUrl: config.PUBLIC_URL,
      corsOrigins: config.CORS_ORIGINS,
    },
    [mountAuctions, mountInvites, mountRead, mountControl, mountAuctioneerToken],
  );
  const apiRoutes = nodeRoutesFor(apiApp, config.PUBLIC_URL);
  const hostExtra = opts.extraRoutes?.(service, stores.room);
  const extra: ExtraRoutes = async (req, res) =>
    (await apiRoutes(req, res)) || (hostExtra !== undefined && (await hostExtra(req, res)));
  const versionRoute = createVersionRoute(resolveSha(env));

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const path = (req.url ?? '').split('?')[0] ?? '';
    // Liveness probes come from the platform, not a client: never limit them.
    if (path === '/healthz') return health.healthz(req, res);
    if (path === '/readyz') return health.readyz(req, res);
    if (path === '/version') return versionRoute(req, res);
    // R-RT-120: per-client HTTP limit; webhook routes are exempt inside checkHttp.
    const limited = limiter.checkHttp(sourceOf(req, config.TRUSTED_PROXY_HOPS) ?? 'unknown', path);
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
  /** R-RT-120: open sockets per source address, released on close. */
  const socketsBySource = new Map<string, number>();
  const http = createServer((req, res) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
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

  const wsHost = createNodeWsHost({
    server: http,
    clock,
    allowedOrigins: wsOrigins(config),
    admitUpgrade: (req) => {
      const source = sourceOf(req, config.TRUSTED_PROXY_HOPS) ?? 'unknown';
      if (!limiter.checkJoin(source).ok) return undefined;
      const open = socketsBySource.get(source) ?? 0;
      if (open >= MAX_SOCKETS_PER_SOURCE) return undefined;
      socketsBySource.set(source, open + 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const left = (socketsBySource.get(source) ?? 1) - 1;
        if (left <= 0) socketsBySource.delete(source);
        else socketsBySource.set(source, left);
      };
    },
    accept: createGateway({
      service,
      store: stores.room,
      clock,
      ids,
      secrets,
      limiter,
    }),
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
