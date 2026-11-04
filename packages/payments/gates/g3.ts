import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FakePayPalServer } from '../src/fake/server.js';
import { centsToDecimal } from '../src/money.js';
import { fetchAccessToken, type GateResponse, type RecordingHttp } from './http.js';
import {
  EXIT_REFUSED,
  GateUsageError,
  parseGateArgs,
  runGate,
  type GateContext,
  type Json,
} from './runner.js';

/**
 * G3: authorization validity against the honor period, and the reauthorize path
 * (SPEC R-PAY-145, T-PAY-092).
 *
 * Day 0 (this script):
 *   G3.1 create, approve and authorize one order of 500 cents per label:
 *        probe (reauthorize at once), d35, d40, d50 (reauthorize later)
 *   G3.2 reauthorize the probe authorization immediately and record the answer
 *   G3.3 save the state file next to the evidence so g3-timed.ts can continue
 *
 * The three timed authorizations are acted on by g3-timed.ts once 3.5, 4 and 5 days
 * have passed. Nothing is decided here: the answers are observations that settle
 * the UNVERIFIED tags on the honor period and on reauthorization.
 *
 * Run with: npx vite-node gates/g3.ts -- [--fake] [--out <dir>] [--resume <file>]
 */

export const G3_SCRIPT_VERSION = 'g3-1';
export const G3_AUTHORIZE_CENTS = 500;
export const DAY_MS = 86_400_000;

export const G3_PROBES = [
  { label: 'probe', dueDays: 0 },
  { label: 'd35', dueDays: 3.5 },
  { label: 'd40', dueDays: 4 },
  { label: 'd50', dueDays: 5 },
] as const;

export type G3Label = (typeof G3_PROBES)[number]['label'];

export interface G3Entry {
  label: G3Label;
  orderId: string;
  authId: string;
  dueDays: number;
  /** Set by g3-timed.ts once the probe has run. */
  doneAtMs?: number;
}

export interface G3State {
  v: 1;
  /** Time the authorizations were created, ms since the epoch. */
  createdAtMs: number;
  entries: G3Entry[];
}

export interface G3Deps {
  /** Approves an order as the buyer. Absent: the run pauses and a person approves. */
  approve?: (info: { orderId: string; approveUrl: string; label: G3Label }) => Promise<void>;
  /** Path of the state file. Default: <evidence dir>/state.json. */
  statePath?: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export function field(json: unknown, key: string): unknown {
  return isRecord(json) ? json[key] : undefined;
}

export function errorName(json: unknown): string {
  const details = field(json, 'details');
  const issue = Array.isArray(details) && isRecord(details[0]) ? str(details[0]['issue']) : '';
  return [str(field(json, 'name')), issue].filter((x) => x !== '').join(' ');
}

export function amount(cents: number): { currency_code: string; value: string } {
  return { currency_code: 'USD', value: centsToDecimal(cents) };
}

/** What one reauthorize call told us. */
export interface ReauthObservation {
  http: number;
  name: string;
  /** Status in the answer body, when there is one. */
  status: string;
  /** Authorization status read right after the call. */
  authStatusAfter: string;
  accepted: boolean;
}

/** Calls reauthorize on one authorization and reads it back. Never throws on an HTTP error. */
export async function probeReauthorize(
  http: RecordingHttp,
  token: string,
  step: string,
  authId: string,
  requestId: string,
): Promise<ReauthObservation> {
  const auth = { Authorization: `Bearer ${token}` };
  const res = await http.request(`${step} reauthorize`, {
    method: 'POST',
    path: `/v2/payments/authorizations/${authId}/reauthorize`,
    headers: { ...auth, 'PayPal-Request-Id': requestId },
    body: { amount: amount(G3_AUTHORIZE_CENTS) },
  });
  const read = await http.request(`${step} read authorization`, {
    method: 'GET',
    path: `/v2/payments/authorizations/${authId}`,
    headers: auth,
  });
  return {
    http: res.status,
    name: errorName(res.json),
    status: str(field(res.json, 'status')),
    authStatusAfter: str(field(read.json, 'status')),
    accepted: res.status >= 200 && res.status < 300,
  };
}

/** Entries whose probe time has come and that have not been probed yet. */
export function dueEntries(state: G3State, nowMs: number): G3Entry[] {
  return state.entries.filter(
    (e) =>
      e.doneAtMs === undefined &&
      e.label !== 'probe' &&
      nowMs - state.createdAtMs >= e.dueDays * DAY_MS,
  );
}

export function parseState(text: string): G3State {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new GateUsageError('state file is not JSON');
  }
  if (!isRecord(raw) || raw['v'] !== 1 || typeof raw['createdAtMs'] !== 'number') {
    throw new GateUsageError('state file has the wrong shape');
  }
  const list = raw['entries'];
  if (!Array.isArray(list)) throw new GateUsageError('state file has no entries');
  const entries: G3Entry[] = [];
  for (const item of list) {
    if (!isRecord(item)) throw new GateUsageError('state entry is not an object');
    const label = G3_PROBES.find((p) => p.label === item['label']);
    if (
      label === undefined ||
      typeof item['orderId'] !== 'string' ||
      typeof item['authId'] !== 'string'
    ) {
      throw new GateUsageError('state entry is incomplete');
    }
    const entry: G3Entry = {
      label: label.label,
      orderId: item['orderId'],
      authId: item['authId'],
      dueDays: label.dueDays,
    };
    if (typeof item['doneAtMs'] === 'number') entry.doneAtMs = item['doneAtMs'];
    entries.push(entry);
  }
  return { v: 1, createdAtMs: raw['createdAtMs'], entries };
}

export function loadState(path: string): G3State {
  if (!existsSync(path)) throw new GateUsageError(`state file not found: ${path}`);
  return parseState(readFileSync(path, 'utf8'));
}

export function saveState(path: string, state: G3State): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  renameSync(tmp, path);
}

function approveLink(json: unknown): string {
  const links = field(json, 'links');
  if (!Array.isArray(links)) return '';
  for (const l of links) {
    if (isRecord(l) && (l['rel'] === 'payer-action' || l['rel'] === 'approve')) {
      return str(l['href']);
    }
  }
  return '';
}

function firstAuthorizationId(json: unknown): string {
  const units = field(json, 'purchase_units');
  const unit = Array.isArray(units) && isRecord(units[0]) ? units[0] : {};
  const payments = isRecord(unit['payments']) ? unit['payments'] : {};
  const list = Array.isArray(payments['authorizations']) ? payments['authorizations'] : [];
  return isRecord(list[0]) ? str(list[0]['id']) : '';
}

function must(res: GateResponse, expected: number, what: string, label: string): void {
  if (res.status === expected) return;
  const name = errorName(res.json);
  throw new Error(
    `G3 ${label}: ${what} answered HTTP ${res.status}${name === '' ? '' : ` (${name})`}, expected ${expected}`,
  );
}

/** Gate body for day 0. */
export async function g3Gate(ctx: GateContext, deps: G3Deps = {}): Promise<void> {
  const http = ctx.http;
  const token = await fetchAccessToken(
    http,
    'G3.0 token',
    ctx.config.clientId,
    ctx.config.clientSecret,
  );
  const auth = { Authorization: `Bearer ${token}` };
  const run = ctx.runId.replace(/[^A-Za-z0-9]/g, '').slice(-14);
  const entries: G3Entry[] = [];

  for (const probe of G3_PROBES) {
    const label = probe.label;
    const key = (name: string): string => `${label}/${name}`;
    http.setBuyer('wallet');
    const order = await ctx.step(key('G3.1 create order'), async (): Promise<Json> => {
      const res = await http.request(`G3.1 create order ${label}`, {
        method: 'POST',
        path: '/v2/checkout/orders',
        headers: { ...auth, 'PayPal-Request-Id': `g3-${run}-${label}-order` },
        body: {
          intent: 'AUTHORIZE',
          purchase_units: [
            {
              reference_id: `g3-${run}-${label}`,
              custom_id: `g3-${run}-${label}`,
              amount: amount(G3_AUTHORIZE_CENTS),
            },
          ],
          payment_source: {
            paypal: {
              experience_context: {
                return_url: 'https://example.com/return',
                cancel_url: 'https://example.com/cancel',
                user_action: 'PAY_NOW',
                shipping_preference: 'NO_SHIPPING',
              },
            },
          },
        },
      });
      must(res, 201, 'order creation', label);
      const orderId = str(field(res.json, 'id'));
      const approveUrl = approveLink(res.json);
      if (orderId === '' || approveUrl === '') {
        throw new Error(`G3 ${label}: order response has no id or approval link`);
      }
      return { orderId, approveUrl };
    });
    const orderId = String((order as { orderId: Json }).orderId);
    const approveUrl = String((order as { approveUrl: Json }).approveUrl);

    if (deps.approve !== undefined) {
      await ctx.step(key('G3.1 approve'), async (): Promise<Json> => {
        await deps.approve?.({ orderId, approveUrl, label });
        return true;
      });
    } else {
      await ctx.waitForApproval(key('G3.1 approve'), approveUrl, `${label}, order ${orderId}`);
    }

    const authId = await ctx.step(key('G3.1 authorize'), async (): Promise<string> => {
      const res = await http.request(`G3.1 authorize ${label}`, {
        method: 'POST',
        path: `/v2/checkout/orders/${orderId}/authorize`,
        headers: { ...auth, 'PayPal-Request-Id': `g3-${run}-${label}-authorize` },
      });
      must(res, 201, 'authorize', label);
      const id = firstAuthorizationId(res.json);
      if (id === '') throw new Error(`G3 ${label}: authorize answered without an authorization id`);
      return id;
    });
    entries.push({ label, orderId, authId, dueDays: probe.dueDays });
  }
  http.setBuyer(undefined);

  // G3.2 immediate reauthorize of the probe authorization.
  const probe = entries.find((e) => e.label === 'probe');
  if (probe === undefined) throw new Error('G3: probe authorization missing');
  const seen = await ctx.step('G3.2 immediate reauthorize', async (): Promise<Json> => {
    const o = await probeReauthorize(
      http,
      token,
      'G3.2 immediate',
      probe.authId,
      `g3-${run}-probe-reauth`,
    );
    return { ...o };
  });
  const o = seen as unknown as ReauthObservation;
  http.note('G3.2 immediate reauthorize', 'immediate reauthorize result', {
    http: o.http,
    name: o.name,
    accepted: o.accepted,
  });
  ctx.log(
    `G3 immediate reauthorize: HTTP ${o.http}${o.name === '' ? '' : ` ${o.name}`}, authorization ${o.authStatusAfter}`,
  );

  // G3.3 persist the state for the timed checks.
  const statePath = deps.statePath ?? join(dirname(ctx.evidencePath), 'state.json');
  const createdAtMs = Date.now();
  saveState(statePath, { v: 1, createdAtMs, entries });
  ctx.log(`G3 state saved to ${statePath}; run g3-timed.ts at day 3.5, 4 and 5`);
}

export interface RunG3Options {
  argv: readonly string[];
  env: Record<string, string | undefined>;
  log?: (message: string) => void;
  /** Fake mode: use this server instead of starting one. Tests only. */
  fakeServer?: FakePayPalServer;
}

/** Entry point. --fake uses a fake PayPal (a given one, or a new loopback one). */
export async function runG3(opts: RunG3Options): Promise<number> {
  const log = opts.log ?? ((m: string) => console.log(m));
  let fake: boolean;
  try {
    fake = parseGateArgs(opts.argv).fake;
  } catch (e) {
    if (e instanceof GateUsageError) {
      log(`refused: ${e.message}`);
      return EXIT_REFUSED;
    }
    throw e;
  }
  let server = opts.fakeServer;
  let started = false;
  let env = { ...opts.env };
  if (fake) {
    if (server === undefined) {
      server = new FakePayPalServer();
      await server.start();
      started = true;
    }
    env = { ...env, PAYPAL_ENV: env['PAYPAL_ENV'] ?? 'sandbox', PAYPAL_BASE_URL: server.url };
  }
  const sha = env['GITHUB_SHA'];
  try {
    return await runGate({
      gate: 'G3',
      scriptVersion: sha !== undefined && sha !== '' ? sha.slice(0, 7) : G3_SCRIPT_VERSION,
      argv: opts.argv,
      env,
      log,
      main: async (ctx) => {
        const deps: G3Deps = {};
        const srv = server;
        if (srv !== undefined) {
          deps.approve = ({ orderId }) => {
            srv.core.approveOrder(orderId);
            return Promise.resolve();
          };
        }
        await g3Gate(ctx, deps);
      },
    });
  } finally {
    if (started) await server?.stop();
  }
}

const isEntry = process.argv
  .slice(1)
  .some((a) => pathToFileURL(resolve(a)).href === import.meta.url);
if (isEntry) {
  runG3({ argv: process.argv.slice(2), env: process.env }).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exitCode = 1;
    },
  );
}
