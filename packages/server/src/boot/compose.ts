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
  type Logger,
  type RoomStore,
} from '@gavel/shared';
import type { AuthRole } from '../auth/authorize';
import { secretSetFromConfig, verifyRotating } from '../auth/rotation';
import type { JtiStore } from '../auth/token';
import { loadConfig, redactConfig, type LoadHooks, type ServerConfig } from '../config';
import { createExportHandler } from '../http/export';
import { createHealthRoutes } from '../http/health';
import { createMetricsRoute } from '../http/metrics';
import { adminKeyMatches } from '../http/ops';
import { createGuardedWebhookRoute } from '../http/webhook-guard';
import { portFromService } from '../http/webhook';
import { createPaymentAudit } from './payment-audit';
import { createLogger, type LogSink } from '../log/logger';
import { MetricsCollector } from '../ops/metrics';
import { createAuctionService, type AuctionService } from '../runtime/auction-service';
import { FileLedgerStore } from '../store/file-ledger-store';
import { acquireDataDirLock } from '../store/data-dir-lock';
import { FileRoomStore } from '../store/file-room-store';
import { MemoryStore } from '../store/memory-store';

export const WEBHOOK_PATH = '/webhooks/paypal';
const EXPORT_PATH = /^\/api\/auctions\/([^/]+)\/export\/?$/;

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
  stop(): Promise<void>;
}

/** The gateway and webhook verifier for the selected mode (R-QA-043, R-PAY-002). */
async function wirePayments(
  config: ServerConfig,
  env: Env,
  clock: SystemClock,
): Promise<PaymentsWiring> {
  const payClock = { nowMs: (): number => clock.now() };
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
        return {
          room: await FileRoomStore.open(join(dir, 'rooms.jsonl'), now),
          ledger: new FileLedgerStore(join(dir, 'ledgers')),
          journals: pay.journals,
          holds: pay.holds,
          webhookEvents: pay.webhooks,
          kill: new FileKillStateStore(join(dir, 'kill-switch.json')),
          release: () => lock.release(),
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

/** Revocation lists are not kept yet: no token is revoked, and only auctioneer tokens reach here. */
const NO_REVOCATIONS: JtiStore = {
  isRevoked: () => Promise.resolve(false),
  consume: () => Promise.resolve(true),
};

function bearerOf(req: IncomingMessage): string | undefined {
  const h = req.headers.authorization;
  if (typeof h !== 'string') return undefined;
  const m = /^Bearer (\S+)$/.exec(h);
  return m?.[1];
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
  const log: Logger = createLogger({
    clock,
    sink: opts.sink ?? ((line) => void process.stdout.write(`${line}\n`)),
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
  const service = createAuctionService({
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
    onError: (auctionId, error) =>
      log.error('settlement stopped', {
        auctionId,
        error: error instanceof Error ? error.message : String(error),
      }),
  });
  await service.resume();
  log.info('server composed', redactConfig(config));

  const metrics = new MetricsCollector({
    connections: () => 0,
    rooms: () => 0,
    mailboxDepth: () => 0,
  });
  const health = createHealthRoutes({
    pingStore: async () => {
      await stores.room.ping();
    },
    migrationsApplied: () => true,
  });
  const secrets = secretSetFromConfig(config);
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
        jtis: NO_REVOCATIONS,
      });
      return result.ok ? 'auctioneer' : undefined;
    },
  });
  const webhookRoute = createGuardedWebhookRoute(portFromService(service), {
    log: {
      info: (m, f) => log.info(m, f),
      warn: (m, f) => log.warn(m, f),
    },
    metrics,
    knownAuction: async (id) => (await stores.room.listAuctions()).includes(id as AuctionId),
  });
  const metricsRoute = createMetricsRoute(metrics, { adminKey: config.ADMIN_KEY });
  const extra = opts.extraRoutes?.(service, stores.room);

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const path = (req.url ?? '').split('?')[0] ?? '';
    if (path === '/healthz') return health.healthz(req, res);
    if (path === '/readyz') return health.readyz(req, res);
    if (path === '/metrics') return metricsRoute(req, res);
    if (path === WEBHOOK_PATH) return webhookRoute(req, res);
    if (EXPORT_PATH.test(path)) return exportRoute(req, res);
    if (extra !== undefined && (await extra(req, res))) return;
    notFound(res);
  };
  const http = createServer((req, res) => {
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
      await new Promise<void>((resolve) => {
        if (!http.listening) return resolve();
        http.close(() => resolve());
        http.closeIdleConnections();
        const force = setTimeout(() => http.closeAllConnections(), graceMs);
        force.unref();
        http.once('close', () => clearTimeout(force));
      });
      await service.close();
      await payments.stop();
      stores.release();
    },
  };
}
