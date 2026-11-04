import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FakePayPalCore } from '../src/fake/core.js';
import { DEFAULT_FAKE_WEBHOOK_ID, FakePayPalServer } from '../src/fake/server.js';
import { WebhookEmitter } from '../src/fake/webhooks.js';
import { assertSandboxUrl } from '../src/guard.js';
import {
  TRANSMISSION_HEADERS,
  VERIFY_PATH,
  buildVerifyBody,
  readRawEvent,
} from '../src/webhooks/verify.js';
import { canonicalJson } from '../src/types.js';
import { lintTokens, redact } from './evidence.js';
import { fetchAccessToken } from './http.js';
import {
  EXIT_REFUSED,
  GateUsageError,
  parseGateArgs,
  runGate,
  type GateContext,
} from './runner.js';

/**
 * G4: real webhooks, verification and comparison with the simulator
 * (SPEC R-PAY-146, T-PAY-093).
 *
 * Input is a receiver log: one JSON object per line, {"headers": {...}, "rawBody": "..."},
 * written by a public receiver that logged each delivery untouched (headers and the raw
 * body bytes as text). For every delivery the script
 *   G4.1 asks PayPal's verify endpoint (the five transmission headers, our webhook id and
 *        the raw event spliced in as received) and records only the outcome, never the
 *        transmission signature,
 *   G4.2 writes a sanitized copy of the event as a fixture (personal fields redacted, a
 *        token-shaped leftover stops the run),
 *   G4.3 records how the event differs from what the simulator emits for the same type.
 * The run passes when every delivery verifies and the log holds a capture and a void event.
 * Fixtures keep their shape but not their bytes, so they do not verify any more.
 *
 * Flags besides the shared ones: --log <file> (receiver log; not used with --fake),
 * --fixtures <dir> (default test/fixtures/webhooks; with --fake <out>/G4/fixtures).
 * The webhook id comes from PAYPAL_WEBHOOK_ID.
 *
 * Run with: npx vite-node gates/g4.ts -- --log <file> [--fixtures <dir>] [--out <dir>]
 */

export const G4_SCRIPT_VERSION = 'g4-1';
export const REQUIRED_EVENT_TYPES = [
  'PAYMENT.CAPTURE.COMPLETED',
  'PAYMENT.AUTHORIZATION.VOIDED',
] as const;

export interface Delivery {
  headers: Record<string, string>;
  rawBody: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Parses a receiver log. A malformed line stops the run with its number. */
export function parseReceiverLog(text: string): Delivery[] {
  const out: Delivery[] = [];
  text.split('\n').forEach((line, i) => {
    if (line.trim() === '') return;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      throw new GateUsageError(`receiver log line ${i + 1} is not JSON`);
    }
    if (!isRecord(raw) || !isRecord(raw['headers']) || typeof raw['rawBody'] !== 'string') {
      throw new GateUsageError(`receiver log line ${i + 1} needs "headers" and "rawBody"`);
    }
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw['headers'])) {
      if (typeof v === 'string') headers[k.toUpperCase()] = v;
    }
    out.push({ headers, rawBody: raw['rawBody'] });
  });
  return out;
}

export interface EventSummary {
  id: string;
  eventType: string;
  topKeys: string[];
  resourceKeys: string[];
}

/** Reads the parts of an event the comparison needs. Undefined when it is not an event. */
export function summarizeEvent(rawBody: string): EventSummary | undefined {
  const text = readRawEvent(rawBody);
  if (text === undefined) return undefined;
  const parsed = JSON.parse(text) as Record<string, unknown>;
  const type = parsed['event_type'];
  const id = parsed['id'];
  if (typeof type !== 'string' || typeof id !== 'string') return undefined;
  const resource = parsed['resource'];
  return {
    id,
    eventType: type,
    topKeys: Object.keys(parsed).sort(),
    resourceKeys: isRecord(resource) ? Object.keys(resource).sort() : [],
  };
}

export interface ShapeDiff {
  onlyReal: string[];
  onlySimulator: string[];
}

/** Keys the real event has and the simulator lacks, and the other way round. */
export function diffKeys(real: readonly string[], simulator: readonly string[]): ShapeDiff {
  return {
    onlyReal: real.filter((k) => !simulator.includes(k)),
    onlySimulator: simulator.filter((k) => !real.includes(k)),
  };
}

/** Shapes of the events the simulator emits for a capture and a void, keyed by event type. */
export function simulatorShapes(): Map<string, EventSummary> {
  const core = new FakePayPalCore();
  const order = core.createOrder({ holdId: 'g4-sim', amountCents: 500, description: 'g4' }, 'r1');
  core.approveOrder(order.id);
  const { authId } = core.authorizeOrder(order.id, 'r2');
  core.capture(authId, 350, true, 'r3');
  const second = core.createOrder({ holdId: 'g4-sim2', amountCents: 500, description: 'g4' }, 'r4');
  core.approveOrder(second.id);
  const other = core.authorizeOrder(second.id, 'r5').authId;
  core.void(other, 'r6');
  const emitter = new WebhookEmitter({ webhookId: 'WH-SIM', nowMs: () => 0 });
  const shapes = new Map<string, EventSummary>();
  for (const e of core.events) {
    const s = summarizeEvent(emitter.sign(e).rawBody);
    if (s !== undefined && !shapes.has(s.eventType)) shapes.set(s.eventType, s);
  }
  return shapes;
}

/** Sanitized event text for a fixture. Throws when something credential-shaped is left. */
export function sanitizeEvent(rawBody: string): string {
  const text = readRawEvent(rawBody);
  if (text === undefined) throw new Error('delivery is not a single JSON event');
  const clean = redact(JSON.parse(text) as unknown);
  const hits = lintTokens(clean);
  if (hits.length > 0)
    throw new Error(`fixture still holds sensitive values at ${hits.join(', ')}`);
  return `${canonicalJson(clean)}\n`;
}

export function fixtureName(eventType: string, index: number): string {
  const slug = eventType
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${slug}-${String(index).padStart(2, '0')}.json`;
}

export interface G4Deps {
  deliveries: readonly Delivery[];
  fixturesDir: string;
  /** Fake mode only: loopback URLs are allowed. */
  fake: boolean;
  /** Overrides fetch for the verify call. */
  fetch?: typeof fetch;
}

function headerOf(d: Delivery, name: string): string {
  return d.headers[name] ?? '';
}

async function verifyDelivery(
  ctx: GateContext,
  deps: G4Deps,
  token: string,
  d: Delivery,
): Promise<{ status: number; verification: string }> {
  const rawEvent = readRawEvent(d.rawBody);
  if (rawEvent === undefined) return { status: 0, verification: 'MALFORMED' };
  const body = buildVerifyBody(
    rawEvent,
    {
      authAlgo: headerOf(d, TRANSMISSION_HEADERS.authAlgo),
      certUrl: headerOf(d, TRANSMISSION_HEADERS.certUrl),
      transmissionId: headerOf(d, TRANSMISSION_HEADERS.transmissionId),
      transmissionSig: headerOf(d, TRANSMISSION_HEADERS.transmissionSig),
      transmissionTime: headerOf(d, TRANSMISSION_HEADERS.transmissionTime),
    },
    ctx.config.webhookId,
  );
  const url = `${ctx.config.baseUrl}${VERIFY_PATH}`;
  assertSandboxUrl(url, { fake: deps.fake });
  const send = deps.fetch ?? fetch;
  const res = await send(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body,
  });
  const text = await res.text();
  let verification = '';
  try {
    const parsed: unknown = JSON.parse(text);
    if (isRecord(parsed) && typeof parsed['verification_status'] === 'string') {
      verification = parsed['verification_status'];
    }
  } catch {
    verification = 'UNREADABLE';
  }
  return { status: res.status, verification };
}

/** Gate body. */
export async function g4Gate(ctx: GateContext, deps: G4Deps): Promise<void> {
  if (deps.deliveries.length === 0) throw new Error('G4: the receiver log has no deliveries');
  if (ctx.config.webhookId === '') {
    throw new Error('G4: PAYPAL_WEBHOOK_ID is not set');
  }
  const token = await fetchAccessToken(
    ctx.http,
    'G4.0 token',
    ctx.config.clientId,
    ctx.config.clientSecret,
  );
  const sim = simulatorShapes();
  mkdirSync(deps.fixturesDir, { recursive: true });
  const seen = new Set<string>();
  const counts = new Map<string, number>();

  for (const [i, d] of deps.deliveries.entries()) {
    const step = `G4.1 delivery ${i + 1}`;
    const summary = summarizeEvent(d.rawBody);
    if (summary === undefined) {
      ctx.check(step, 'delivery is a JSON event', true, false);
      continue;
    }
    seen.add(summary.eventType);
    const v = await verifyDelivery(ctx, deps, token, d);
    ctx.http.note(step, `verify ${summary.eventType}`, {
      eventId: summary.id,
      transmissionId: headerOf(d, TRANSMISSION_HEADERS.transmissionId),
      http: v.status,
      verification: v.verification,
    });
    ctx.check(step, `${summary.eventType} verifies`, 'SUCCESS', v.verification);

    // G4.2 sanitized fixture, one per delivery.
    const n = (counts.get(summary.eventType) ?? 0) + 1;
    counts.set(summary.eventType, n);
    const file = join(deps.fixturesDir, fixtureName(summary.eventType, n));
    writeFileSync(file, sanitizeEvent(d.rawBody), 'utf8');
    ctx.http.note(`G4.2 fixture ${i + 1}`, 'fixture written', {
      file: fixtureName(summary.eventType, n),
    });

    // G4.3 shape against the simulator.
    const expected = sim.get(summary.eventType);
    if (expected === undefined) {
      ctx.http.note(`G4.3 shape ${i + 1}`, `simulator has no ${summary.eventType}`, true);
    } else {
      ctx.http.note(`G4.3 shape ${i + 1}`, `${summary.eventType} against simulator`, {
        top: diffKeys(summary.topKeys, expected.topKeys),
        resource: diffKeys(summary.resourceKeys, expected.resourceKeys),
      });
    }
  }

  for (const type of REQUIRED_EVENT_TYPES) {
    ctx.check('G4.4 coverage', `log holds ${type}`, true, seen.has(type));
  }
}

export interface RunG4Options {
  argv: readonly string[];
  env: Record<string, string | undefined>;
  log?: (message: string) => void;
}

interface G4Flags {
  logFile?: string;
  fixtures?: string;
  rest: string[];
}

function parseG4Flags(argv: readonly string[]): G4Flags {
  const flags: G4Flags = { rest: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] ?? '';
    if (a === '--log' || a === '--fixtures') {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new GateUsageError(`${a} needs a value`);
      if (a === '--log') flags.logFile = v;
      else flags.fixtures = v;
      i += 1;
    } else flags.rest.push(a);
  }
  return flags;
}

/** Deliveries a fake receiver would log for a capture and a void. */
function fakeDeliveries(server: FakePayPalServer): Delivery[] {
  const core = server.core;
  const order = core.createOrder(
    { holdId: 'g4-fake', amountCents: 500, description: 'g4' },
    'g4-1',
  );
  core.approveOrder(order.id);
  const { authId } = core.authorizeOrder(order.id, 'g4-2');
  core.capture(authId, 350, true, 'g4-3');
  const second = core.createOrder(
    { holdId: 'g4-fake-2', amountCents: 500, description: 'g4' },
    'g4-4',
  );
  core.approveOrder(second.id);
  const other = core.authorizeOrder(second.id, 'g4-5').authId;
  core.void(other, 'g4-6');
  const emitter = new WebhookEmitter({
    webhookId: DEFAULT_FAKE_WEBHOOK_ID,
    nowMs: () => core.clock.nowMs(),
  });
  return emitter.prepare(core.events).map((d) => ({ headers: d.headers, rawBody: d.rawBody }));
}

/** Entry point. --fake generates the receiver log from the fake PayPal. */
export async function runG4(opts: RunG4Options): Promise<number> {
  const log = opts.log ?? ((m: string) => console.log(m));
  let flags: G4Flags;
  let fake: boolean;
  try {
    flags = parseG4Flags(opts.argv);
    const parsed = parseGateArgs(flags.rest);
    fake = parsed.fake;
    if (!fake && flags.logFile === undefined) throw new GateUsageError('--log <file> is required');
  } catch (e) {
    if (e instanceof GateUsageError) {
      log(`refused: ${e.message}`);
      return EXIT_REFUSED;
    }
    throw e;
  }

  let deliveries: Delivery[] = [];
  let server: FakePayPalServer | undefined;
  let env = { ...opts.env };
  if (fake) {
    server = new FakePayPalServer();
    await server.start();
    env = {
      ...env,
      PAYPAL_ENV: env['PAYPAL_ENV'] ?? 'sandbox',
      PAYPAL_BASE_URL: server.url,
      PAYPAL_WEBHOOK_ID: DEFAULT_FAKE_WEBHOOK_ID,
    };
    deliveries = fakeDeliveries(server);
  } else {
    const file = flags.logFile ?? '';
    if (!existsSync(file)) {
      log(`refused: receiver log not found: ${file}`);
      return EXIT_REFUSED;
    }
    try {
      deliveries = parseReceiverLog(readFileSync(file, 'utf8'));
    } catch (e) {
      if (e instanceof GateUsageError) {
        log(`refused: ${e.message}`);
        return EXIT_REFUSED;
      }
      throw e;
    }
  }
  const sha = env['GITHUB_SHA'];
  try {
    return await runGate({
      gate: 'G4',
      scriptVersion: sha !== undefined && sha !== '' ? sha.slice(0, 7) : G4_SCRIPT_VERSION,
      argv: flags.rest,
      env,
      log,
      main: async (ctx) => {
        const fixturesDir =
          flags.fixtures ??
          (fake ? join(dirname(ctx.evidencePath), 'fixtures') : 'test/fixtures/webhooks');
        await g4Gate(ctx, { deliveries, fixturesDir, fake });
      },
    });
  } finally {
    await server?.stop();
  }
}

const isEntry = process.argv
  .slice(1)
  .some((a) => pathToFileURL(resolve(a)).href === import.meta.url);
if (isEntry) {
  runG4({ argv: process.argv.slice(2), env: process.env }).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exitCode = 1;
    },
  );
}
