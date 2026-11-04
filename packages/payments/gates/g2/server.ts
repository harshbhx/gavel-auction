import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FakePayPalServer } from '../../src/fake/server.js';
import { amount, errorName, field, firstAuthorization, str } from '../gateUtil.js';
import { fetchAccessToken } from '../http.js';
import {
  EXIT_REFUSED,
  GateUsageError,
  parseGateArgs,
  runGate,
  type GateContext,
} from '../runner.js';
import { appendEntry, withEvidenceHash, type Decision, type GateRow } from '../summarize.js';

/**
 * G2: SDK v6 AUTHORIZE page for the PayPal wallet and a guest card (SPEC R-PAY-144, T-PAY-091).
 *
 * A tiny server and one page. The server fetches the client token, creates AUTHORIZE orders and
 * authorizes them after the SDK reports the buyer's approval; every PayPal call goes through the
 * recording HTTP layer, so order ids and authorization ids end up in the evidence file. The
 * page reports the paths the SDK does not offer. The run ends when both paths have an outcome
 * and appends the GATES.md entry (decision matrix, SPEC 7.3).
 *
 * This needs a person at a browser: open the printed URL (localhost works with the sandbox),
 * pay once with the wallet and once as a guest with a sandbox test card, and take a screenshot of
 * each finished box. It does not run in CI, only --fake does.
 *
 * Flags besides the shared ones: --port <n> (default 4242), --timeout-min <n> (default 30),
 * --fake-card offered|not-offered (fake only).
 * Run with: npm run gate:g2 -w @gavel/payments [-- --fake]
 */

export const G2_SCRIPT_VERSION = 'g2-1';
export const G2_HOLD_CENTS = 500;
export const SANDBOX_SDK_URL = 'https://www.sandbox.paypal.com/web-sdk/v6/core';

export type G2Path = 'wallet' | 'card';
export type G2Outcome = 'authorized' | 'not_offered' | 'cancelled' | 'error';

export interface G2PathResult {
  outcome: G2Outcome;
  orderId?: string;
  authId?: string;
  detail?: string;
}

export type G2Results = Partial<Record<G2Path, G2PathResult>>;

function isPath(v: unknown): v is G2Path {
  return v === 'wallet' || v === 'card';
}

/** Cancelled and error outcomes are not final: the buyer may try again. */
function isFinal(r: G2PathResult | undefined): boolean {
  return r !== undefined && (r.outcome === 'authorized' || r.outcome === 'not_offered');
}

export function g2Finished(results: G2Results): boolean {
  return isFinal(results.wallet) && isFinal(results.card);
}

/** Decision of SPEC 7.3 for G2. */
export function decideG2(results: G2Results): {
  decision: Decision;
  rule: string;
  fallback: string;
  flippedTags: string[];
} {
  const flippedTags = ['R-PAY-036', 'R-PAY-037'];
  if (results.wallet?.outcome !== 'authorized') {
    return {
      decision: 'FAIL',
      rule: 'wallet AUTHORIZE did not complete in SDK v6',
      fallback: 'server-side approval link instead of the SDK; escalate with the evidence',
      flippedTags: [],
    };
  }
  if (results.card?.outcome === 'authorized') {
    return {
      decision: 'PASS',
      rule: 'card AUTHORIZE works in SDK v6: enable card in the UI (g2_card_authorize true)',
      fallback: '',
      flippedTags,
    };
  }
  return {
    decision: 'PASS-WITH-FALLBACK',
    rule: 'card AUTHORIZE not offered or failed: wallet only, change the copy (g2_card_authorize false)',
    fallback: 'restrict registration to wallet buyers (R-PAY-037)',
    flippedTags,
  };
}

export interface G2ServerDeps {
  /** Page file; default is index.html next to this file. */
  pageHtml?: string;
  sdkUrl: string;
  /** Host the buyer's browser reaches, for the client token domain. */
  domain: string;
}

export interface G2Server {
  url: string;
  results: G2Results;
  /** Resolves when both paths are final, or rejects on timeout. */
  done(timeoutMs: number): Promise<G2Results>;
  close(): Promise<void>;
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((res, rej) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 65_536) {
        rej(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try {
        res(text === '' ? {} : JSON.parse(text));
      } catch {
        rej(new Error('body is not json'));
      }
    });
    req.on('error', rej);
  });
}

function send(res: ServerResponse, status: number, body: unknown, type = 'application/json'): void {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

/** Starts the page server on 127.0.0.1. */
export async function startG2Server(
  ctx: GateContext,
  token: string,
  deps: G2ServerDeps,
  port: number,
): Promise<G2Server> {
  const results: G2Results = {};
  const auth = { Authorization: `Bearer ${token}` };
  const run = ctx.runId.replace(/[^A-Za-z0-9]/g, '').slice(-14);
  const page =
    deps.pageHtml ??
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.html'), 'utf8');
  let counter = 0;
  let waiter: (() => void) | undefined;
  const settle = (): void => {
    if (g2Finished(results)) waiter?.();
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/') {
      send(res, 200, page, 'text/html; charset=utf-8');
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/config') {
      const tokenRes = await ctx.http.request('G2.1 client token', {
        method: 'POST',
        path: '/v1/oauth2/token',
        headers: {
          Authorization: `Basic ${Buffer.from(`${ctx.config.clientId}:${ctx.config.clientSecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `grant_type=client_credentials&response_type=client_token&intent=sdk_init&domains[]=${encodeURIComponent(deps.domain)}`,
      });
      const clientToken = str(field(tokenRes.json, 'access_token'));
      send(res, 200, { clientToken, sdkUrl: deps.sdkUrl });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/orders') {
      const body = await readBody(req);
      const path = field(body, 'path');
      if (!isPath(path)) return send(res, 400, { error: 'path must be wallet or card' });
      ctx.http.setBuyer(path);
      counter += 1;
      const r = await ctx.http.request(`G2.2 create order (${path})`, {
        method: 'POST',
        path: '/v2/checkout/orders',
        headers: { ...auth, 'PayPal-Request-Id': `g2-${run}-${path}-order-${counter}` },
        body: {
          intent: 'AUTHORIZE',
          purchase_units: [
            {
              reference_id: `g2-${run}-${path}`,
              custom_id: `g2-${run}-${path}`,
              amount: amount(G2_HOLD_CENTS),
            },
          ],
        },
      });
      const orderId = str(field(r.json, 'id'));
      if (r.status !== 201 || orderId === '') {
        results[path] = {
          outcome: 'error',
          detail: `order creation HTTP ${r.status} ${errorName(r.json)}`.trim(),
        };
        return send(res, 502, { error: 'order creation failed', status: r.status });
      }
      return send(res, 200, { orderId });
    }
    const authorize = /^\/api\/orders\/([A-Za-z0-9_-]{1,64})\/authorize$/.exec(url.pathname);
    if (req.method === 'POST' && authorize !== null) {
      const orderId = authorize[1] ?? '';
      const body = await readBody(req);
      const path = field(body, 'path');
      if (!isPath(path)) return send(res, 400, { error: 'path must be wallet or card' });
      ctx.http.setBuyer(path);
      const r = await ctx.http.request(`G2.3 authorize (${path})`, {
        method: 'POST',
        path: `/v2/checkout/orders/${orderId}/authorize`,
        headers: { ...auth, 'PayPal-Request-Id': `g2-${run}-${path}-auth-${orderId}` },
      });
      const authId = str(firstAuthorization(r.json)['id']);
      if (r.status !== 201 || authId === '') {
        const detail = `authorize HTTP ${r.status} ${errorName(r.json)}`.trim();
        results[path] = { outcome: 'error', orderId, detail };
        return send(res, 502, { authorized: false, detail });
      }
      results[path] = { outcome: 'authorized', orderId, authId };
      ctx.http.note(`G2.3 authorize (${path})`, 'order and authorization ids', { orderId, authId });
      settle();
      return send(res, 200, { authorized: true, orderId, authId });
    }
    if (req.method === 'POST' && url.pathname === '/api/report') {
      const body = await readBody(req);
      const path = field(body, 'path');
      const outcome = field(body, 'outcome');
      if (
        !isPath(path) ||
        (outcome !== 'not_offered' && outcome !== 'cancelled' && outcome !== 'error')
      ) {
        return send(res, 400, { error: 'bad report' });
      }
      // An authorized path is never overwritten by a later report.
      if (results[path]?.outcome !== 'authorized') {
        results[path] = { outcome, detail: str(field(body, 'detail')).slice(0, 300) };
        ctx.http.setBuyer(path);
        ctx.http.note(`G2.4 report (${path})`, 'page report', {
          outcome,
          detail: results[path]?.detail ?? '',
        });
      }
      settle();
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: 'not found' });
  };

  const server: Server = createServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      send(res, 500, { error: e instanceof Error ? e.message.slice(0, 200) : 'failed' });
    });
  });
  await new Promise<void>((ok, bad) => {
    server.once('error', bad);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', bad);
      ok();
    });
  });
  const addr = server.address() as AddressInfo;
  return {
    url: `http://localhost:${addr.port}`,
    results,
    done: (timeoutMs) =>
      new Promise<G2Results>((ok, bad) => {
        if (g2Finished(results)) return ok(results);
        const timer = setTimeout(() => {
          waiter = undefined;
          bad(
            new Error(
              `G2 timed out: wallet ${results.wallet?.outcome ?? 'no outcome'}, card ${results.card?.outcome ?? 'no outcome'}`,
            ),
          );
        }, timeoutMs);
        waiter = () => {
          clearTimeout(timer);
          ok(results);
        };
      }),
    close: () =>
      new Promise<void>((ok) => {
        server.closeAllConnections();
        server.close(() => ok());
      }),
  };
}

function rowsFor(results: G2Results): GateRow[] {
  const row = (path: G2Path): GateRow => {
    const r = results[path];
    return {
      id: `G2 ${path} AUTHORIZE`,
      expected: 'order and authorization created',
      actual:
        r === undefined
          ? 'no outcome'
          : r.outcome === 'authorized'
            ? `authorized, order ${r.orderId ?? ''}, authorization ${r.authId ?? ''}`
            : `${r.outcome}${r.detail === undefined || r.detail === '' ? '' : `: ${r.detail}`}`,
      verdict: r?.outcome === 'authorized' ? 'PASS' : 'observed',
    };
  };
  return [row('wallet'), row('card')];
}

export interface G2Deps {
  port: number;
  timeoutMs: number;
  sdkUrl: string;
  /** Fake runs: drives the page's calls instead of a person. */
  drive?: (baseUrl: string) => Promise<void>;
  gatesMdPath?: string;
}

/** Gate body. */
export async function g2Gate(ctx: GateContext, deps: G2Deps): Promise<void> {
  const token = await fetchAccessToken(
    ctx.http,
    'G2.0 token',
    ctx.config.clientId,
    ctx.config.clientSecret,
  );
  const srv = await startG2Server(
    ctx,
    token,
    { sdkUrl: deps.sdkUrl, domain: 'localhost' },
    deps.port,
  );
  try {
    ctx.log(
      `G2 page: ${srv.url}  (open it in a browser, pay once with the wallet and once as a guest with a card)`,
    );
    if (deps.drive !== undefined) await deps.drive(srv.url);
    const results = await srv.done(deps.timeoutMs);
    const verdict = decideG2(results);
    ctx.check(
      'G2.5 wallet AUTHORIZE',
      'wallet authorized',
      'authorized',
      results.wallet?.outcome ?? 'none',
    );
    ctx.log(`G2 decision: ${verdict.decision}. ${verdict.rule}`);
    const gatesPath = deps.gatesMdPath ?? join(dirname(dirname(ctx.evidencePath)), 'GATES.md');
    if (!existsSync(gatesPath)) writeFileSync(gatesPath, '# Gates\n', 'utf8');
    const sha = process.env['GITHUB_SHA'];
    const entry = withEvidenceHash(
      {
        gate: 'G2',
        title: 'card and guest AUTHORIZE',
        runId: ctx.runId,
        operator: process.env['GITHUB_ACTOR'] ?? process.env['USER'] ?? 'local',
        date: new Date().toISOString().slice(0, 10),
        scriptSha: sha !== undefined && sha !== '' ? sha.slice(0, 7) : G2_SCRIPT_VERSION,
        buyers: ['wallet', 'guest card'],
        rows: [
          ...rowsFor(results),
          {
            id: 'G2 rule',
            expected: 'PASS or PASS-WITH-FALLBACK',
            actual: verdict.rule,
            verdict: verdict.decision,
          },
        ],
        evidencePath: relative(process.cwd(), ctx.evidencePath) || ctx.evidencePath,
        decision: verdict.decision,
        fallback: verdict.fallback,
        flippedTags: verdict.flippedTags,
      },
      readFileSync(ctx.evidencePath, 'utf8'),
    );
    appendEntry(gatesPath, entry);
    ctx.log(`GATES entry appended to ${gatesPath}`);
  } finally {
    await srv.close();
  }
}

export interface RunG2Options {
  argv: readonly string[];
  env: Record<string, string | undefined>;
  log?: (message: string) => void;
}

interface G2Flags {
  port: number;
  timeoutMin: number;
  fakeCard: 'offered' | 'not-offered';
  rest: string[];
}

function parseG2Flags(argv: readonly string[]): G2Flags {
  const flags: G2Flags = { port: 4242, timeoutMin: 30, fakeCard: 'offered', rest: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] ?? '';
    const v = argv[i + 1];
    if (a === '--port' || a === '--timeout-min') {
      const n = Number(v);
      if (v === undefined || !Number.isInteger(n) || n < 0 || n > 65_535) {
        throw new GateUsageError(`${a} needs a whole number`);
      }
      if (a === '--port') flags.port = n;
      else flags.timeoutMin = n;
      i += 1;
    } else if (a === '--fake-card') {
      if (v !== 'offered' && v !== 'not-offered') {
        throw new GateUsageError('--fake-card needs offered or not-offered');
      }
      flags.fakeCard = v;
      i += 1;
    } else flags.rest.push(a);
  }
  return flags;
}

async function postJson(url: string, body: unknown): Promise<unknown> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

/** Entry point. --fake drives the page's calls against the fake PayPal. */
export async function runG2(opts: RunG2Options): Promise<number> {
  const log = opts.log ?? ((m: string) => console.log(m));
  let flags: G2Flags;
  let fake: boolean;
  try {
    flags = parseG2Flags(opts.argv);
    fake = parseGateArgs(flags.rest).fake;
  } catch (e) {
    if (e instanceof GateUsageError) {
      log(`refused: ${e.message}`);
      return EXIT_REFUSED;
    }
    throw e;
  }
  let server: FakePayPalServer | undefined;
  let env = { ...opts.env };
  if (fake) {
    server = new FakePayPalServer();
    await server.start();
    env = { ...env, PAYPAL_ENV: env['PAYPAL_ENV'] ?? 'sandbox', PAYPAL_BASE_URL: server.url };
  }
  const sha = env['GITHUB_SHA'];
  try {
    return await runGate({
      gate: 'G2',
      scriptVersion: sha !== undefined && sha !== '' ? sha.slice(0, 7) : G2_SCRIPT_VERSION,
      argv: flags.rest,
      env,
      log,
      main: async (ctx) => {
        const deps: G2Deps = {
          port: fake ? 0 : flags.port,
          timeoutMs: flags.timeoutMin * 60_000,
          sdkUrl: SANDBOX_SDK_URL,
        };
        const fakeSrv = server;
        if (fakeSrv !== undefined) {
          deps.drive = async (base) => {
            await fetch(`${base}/api/config`);
            const wallet = (await postJson(`${base}/api/orders`, { path: 'wallet' })) as {
              orderId: string;
            };
            fakeSrv.core.approveOrder(wallet.orderId);
            await postJson(`${base}/api/orders/${wallet.orderId}/authorize`, { path: 'wallet' });
            if (flags.fakeCard === 'offered') {
              const card = (await postJson(`${base}/api/orders`, { path: 'card' })) as {
                orderId: string;
              };
              fakeSrv.core.approveOrder(card.orderId);
              await postJson(`${base}/api/orders/${card.orderId}/authorize`, { path: 'card' });
            } else {
              await postJson(`${base}/api/report`, {
                path: 'card',
                outcome: 'not_offered',
                detail: '',
              });
            }
          };
        } else {
          deps.gatesMdPath = join(dirname(dirname(ctx.evidencePath)), '..', 'GATES.md');
        }
        await g2Gate(ctx, deps);
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
  runG2({ argv: process.argv.slice(2), env: process.env }).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exitCode = 1;
    },
  );
}
