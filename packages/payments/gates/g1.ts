import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FakePayPalServer } from '../src/fake/server.js';
import {
  approveInBrowser,
  comparePayer,
  isSandboxApproveUrl,
  loadPlaywrightLauncher,
  missingBuyerSecrets,
  type BrowserLauncher,
} from './buyerApproval.js';
import {
  amount,
  approveLink,
  buyerCredentials,
  errorName,
  field,
  firstAuthorization,
  payerEmail,
  str,
} from './gateUtil.js';
import { fetchAccessToken, type GateResponse } from './http.js';
import {
  EXIT_REFUSED,
  GateUsageError,
  parseGateArgs,
  runGate,
  type GateContext,
  type Json,
} from './runner.js';
import { appendEntry, withEvidenceHash, type Decision, type GateRow } from './summarize.js';

/**
 * G1: partial capture and remainder release (SPEC R-PAY-143, T-PAY-079, T-PAY-090).
 *
 * Per buyer (wallet always, card when its credentials are given):
 *   G1.1 create an AUTHORIZE order of 500 cents
 *   G1.2 buyer approval (headless browser with --browser, else the run pauses, exit 3)
 *   G1.3 authorize, G1.4 read the authorization
 *   G1.5 capture 350 cents with final_capture=true (and invoice_id)
 *   G1.6 read authorization and order: is the 150 cents remainder open or released?
 *   G1.7 explicit void attempt, G1.8 read authorization again
 *
 * Decision per buyer (SPEC 7.3): A remainder released after the final capture, B remainder
 * still open and the explicit void works, C remainder open and the void is rejected, FAIL when
 * the capture itself is rejected. The run ends with an entry appended to docs/GATES.md.
 *
 * Flags besides the shared ones: --browser (approve in a headless browser; needs the
 * SANDBOX_BUYER_EMAIL and SANDBOX_BUYER_PASSWORD secrets), --fake-remainder released|open
 * (fake mode only: how the fake treats the remainder after a final capture).
 *
 * Run with: npm run gate:g1 -w @gavel/payments [-- --fake] [--browser] [--resume <file>]
 */

export const G1_SCRIPT_VERSION = 'g1-1';
export const G1_AUTHORIZE_CENTS = 500;
export const G1_CAPTURE_CENTS = 350;

export type BuyerLabel = 'wallet' | 'card';
export type G1Decision = 'A' | 'B' | 'C' | 'FAIL';

export interface G1Observed {
  buyer: BuyerLabel;
  orderId: string;
  authId: string;
  /** Authorization status right after authorize. */
  authStatusBefore: string;
  captureHttp: number;
  captureStatus: string;
  captureFinal: boolean | null;
  /** Authorization status after the final capture. */
  authStatusAfterCapture: string;
  orderStatusAfterCapture: string;
  voidHttp: number;
  voidName: string;
  authStatusAfterVoid: string;
  remainderOpen: boolean;
  decision: G1Decision;
}

export interface G1Deps {
  /** Approves an order as the buyer. Absent: the run pauses and a person approves. */
  approve?: (info: { orderId: string; approveUrl: string; buyer: BuyerLabel }) => Promise<void>;
  /** Buyers to run, in order. Default: wallet only. */
  buyers?: readonly BuyerLabel[];
  /** Email of the configured buyer per label, for the payer check. Never recorded. */
  buyerEmails?: Partial<Record<BuyerLabel, string>>;
  /** Waits between capture and the read that observes the remainder. */
  sleep?: (ms: number) => Promise<void>;
  /** Path of the gates document to append to. */
  gatesMdPath?: string;
}

/** Statuses of an authorization that mean no part of the amount is still held. */
const RELEASED_STATUSES: ReadonlySet<string> = new Set(['CAPTURED', 'VOIDED', 'EXPIRED']);

/** Pure decision function of SPEC 7.3. */
export function decideG1(o: {
  captureHttp: number;
  authStatusAfterCapture: string;
  voidHttp: number;
}): { decision: G1Decision; remainderOpen: boolean } {
  const releasedByStatus = RELEASED_STATUSES.has(o.authStatusAfterCapture);
  if (o.captureHttp < 200 || o.captureHttp >= 300) {
    return { decision: 'FAIL', remainderOpen: !releasedByStatus };
  }
  // A void is accepted only while something is still held, so an accepted void after the
  // final capture proves the remainder was open even when the authorization reads CAPTURED.
  const voided = o.voidHttp >= 200 && o.voidHttp < 300;
  if (voided) return { decision: 'B', remainderOpen: true };
  if (releasedByStatus) return { decision: 'A', remainderOpen: false };
  return { decision: 'C', remainderOpen: true };
}

/** Combines per-buyer decisions into the GATES.md decision, the fallback and the flipped tags. */
export function summarizeDecisions(observed: readonly G1Observed[]): {
  decision: Decision;
  fallback: string;
  flippedTags: string[];
  letters: string;
} {
  const letters = observed.map((o) => `${o.buyer}=${o.decision}`).join(', ');
  const wallet = observed.find((o) => o.buyer === 'wallet');
  const card = observed.find((o) => o.buyer === 'card');
  if (wallet === undefined || wallet.decision === 'FAIL' || wallet.decision === 'C') {
    return {
      decision: 'FAIL',
      fallback:
        'capture the winning price and void the authorization explicitly; escalate with the evidence',
      flippedTags: [],
      letters,
    };
  }
  const flippedTags = ['R-PAY-059', 'R-PAY-051'];
  if (card === undefined) {
    // Guest card buyers were never exercised: the result cannot read as a full PASS.
    return {
      decision: 'PASS-WITH-FALLBACK',
      fallback: 'wallet buyers only, card untested (R-PAY-037)',
      flippedTags,
      letters,
    };
  }
  if (card !== undefined && (card.decision === 'FAIL' || card.decision === 'C')) {
    return {
      decision: 'PASS-WITH-FALLBACK',
      fallback: 'wallet buyers only (R-PAY-037)',
      flippedTags,
      letters,
    };
  }
  if (observed.some((o) => o.decision === 'B')) {
    return {
      decision: 'PASS-WITH-FALLBACK',
      fallback: 'the saga void phase includes the winner remainder (R-PAY-059)',
      flippedTags,
      letters,
    };
  }
  return { decision: 'PASS', fallback: '', flippedTags, letters };
}

function must(res: GateResponse, expected: number, what: string, buyer: BuyerLabel): void {
  if (res.status === expected) return;
  const name = errorName(res.json);
  throw new Error(
    `G1 ${buyer}: ${what} answered HTTP ${res.status}${name === '' ? '' : ` (${name})`}, expected ${expected}`,
  );
}

async function runBuyer(
  ctx: GateContext,
  deps: G1Deps,
  token: string,
  buyer: BuyerLabel,
): Promise<G1Observed> {
  const http = ctx.http;
  http.setBuyer(buyer);
  const auth = { Authorization: `Bearer ${token}` };
  const run = ctx.runId.replace(/[^A-Za-z0-9]/g, '').slice(-14);
  const rid = (op: string): string => `g1-${run}-${buyer}-${op}`;
  const key = (name: string): string => `${buyer}/${name}`;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const order = await ctx.step(key('G1.1 create order'), async (): Promise<Json> => {
    const res = await http.request('G1.1 create order', {
      method: 'POST',
      path: '/v2/checkout/orders',
      headers: { ...auth, 'PayPal-Request-Id': rid('order') },
      body: {
        intent: 'AUTHORIZE',
        purchase_units: [
          {
            reference_id: `g1-${run}-${buyer}`,
            custom_id: `g1-${run}-${buyer}`,
            amount: amount(G1_AUTHORIZE_CENTS),
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
    must(res, 201, 'order creation', buyer);
    const orderId = str(field(res.json, 'id'));
    const approveUrl = approveLink(res.json);
    if (orderId === '' || approveUrl === '') {
      throw new Error(`G1 ${buyer}: order response has no id or approval link`);
    }
    return { orderId, approveUrl };
  });
  const orderId = String((order as { orderId: Json }).orderId);
  const approveUrl = String((order as { approveUrl: Json }).approveUrl);

  // G1.2 buyer approval.
  if (deps.approve !== undefined) {
    await ctx.step(key('G1.2 approve'), async (): Promise<Json> => {
      await deps.approve?.({ orderId, approveUrl, buyer });
      http.note('G1.2 approve order', 'buyer approval finished', buyer);
      return true;
    });
  } else {
    await ctx.waitForApproval(key('G1.2 approve'), approveUrl, `${buyer} buyer, order ${orderId}`);
  }
  const approved = await ctx.step(key('G1.2 order after approval'), async (): Promise<Json> => {
    const res = await http.request('G1.2 order after approval', {
      method: 'GET',
      path: `/v2/checkout/orders/${orderId}`,
      headers: auth,
    });
    must(res, 200, 'order read after approval', buyer);
    const status = str(field(res.json, 'status'));
    if (status !== 'APPROVED') {
      throw new Error(
        `G1 ${buyer}: order is ${status} after approval, expected APPROVED; the buyer did not complete the payment`,
      );
    }
    const wanted = deps.buyerEmails?.[buyer];
    const payer = wanted === undefined ? 'unknown' : comparePayer(payerEmail(res.json), wanted);
    return { payer };
  });
  const payer = String((approved as { payer: Json }).payer);
  ctx.check(
    'G1.2 order after approval',
    'approved by the configured buyer',
    true,
    payer !== 'mismatch',
  );
  if (payer === 'mismatch') {
    throw new Error(
      `G1 ${buyer}: the order was approved by a different account than the configured buyer; ` +
        'SANDBOX_BUYER_EMAIL probably holds the business (seller) account, use a personal sandbox account',
    );
  }

  // G1.3 authorize and G1.4 read.
  const authId = await ctx.step(key('G1.3 authorize'), async (): Promise<string> => {
    const res = await http.request('G1.3 authorize', {
      method: 'POST',
      path: `/v2/checkout/orders/${orderId}/authorize`,
      headers: { ...auth, 'PayPal-Request-Id': rid('authorize') },
    });
    must(res, 201, 'authorize', buyer);
    const id = str(firstAuthorization(res.json)['id']);
    if (id === '') throw new Error(`G1 ${buyer}: authorize answered without an authorization id`);
    return id;
  });

  const authStatusBefore = await ctx.step(key('G1.4 read authorization'), async () => {
    const res = await http.request('G1.4 read authorization', {
      method: 'GET',
      path: `/v2/payments/authorizations/${authId}`,
      headers: auth,
    });
    must(res, 200, 'authorization read', buyer);
    return str(field(res.json, 'status'));
  });
  ctx.check('G1.4 read authorization', 'authorization is CREATED', 'CREATED', authStatusBefore);

  // G1.5 capture 350 of 500 with final_capture.
  const capture = await ctx.step(key('G1.5 capture 350 final'), async (): Promise<Json> => {
    const res = await http.request('G1.5 capture 350 final', {
      method: 'POST',
      path: `/v2/payments/authorizations/${authId}/capture`,
      headers: { ...auth, 'PayPal-Request-Id': rid('capture') },
      body: {
        amount: amount(G1_CAPTURE_CENTS),
        final_capture: true,
        invoice_id: `g1-${run}-${buyer}`,
      },
    });
    const final = field(res.json, 'final_capture');
    return {
      http: res.status,
      status: str(field(res.json, 'status')),
      final: typeof final === 'boolean' ? final : null,
      name: errorName(res.json),
    };
  });
  const cap = capture as { http: number; status: string; final: boolean | null; name: string };
  ctx.check('G1.5 capture 350 final', 'capture accepted', true, cap.http >= 200 && cap.http < 300);
  if (cap.http >= 200 && cap.http < 300 && cap.status !== 'COMPLETED' && cap.status !== 'PENDING') {
    throw new Error(`G1 ${buyer}: capture answered HTTP ${cap.http} with status '${cap.status}'`);
  }
  if (cap.http < 200 || cap.http >= 300) {
    ctx.log(
      `G1 ${buyer}: capture of ${G1_CAPTURE_CENTS} cents with final_capture=true answered HTTP ${cap.http}${cap.name === '' ? '' : ` (${cap.name})`}`,
    );
  }

  // G1.6 observe the remainder.
  await ctx.step(key('G1.6 wait'), async (): Promise<Json> => {
    await sleep(4000);
    return true;
  });
  const after = await ctx.step(key('G1.6 observe remainder'), async (): Promise<Json> => {
    const readAuth = (): Promise<GateResponse> =>
      http.request('G1.6 read authorization after capture', {
        method: 'GET',
        path: `/v2/payments/authorizations/${authId}`,
        headers: auth,
      });
    // Poll until two reads in a row agree (at most four reads) so an early read is not a result.
    let a = await readAuth();
    for (let i = 0; i < 3; i += 1) {
      await sleep(2000);
      const next = await readAuth();
      const stable = str(field(next.json, 'status')) === str(field(a.json, 'status'));
      a = next;
      if (stable) break;
    }
    const o = await http.request('G1.6 read order after capture', {
      method: 'GET',
      path: `/v2/checkout/orders/${orderId}`,
      headers: auth,
    });
    must(a, 200, 'authorization read after capture', buyer);
    must(o, 200, 'order read after capture', buyer);
    const authStatus = str(field(a.json, 'status'));
    if (authStatus === '') {
      throw new Error(`G1 ${buyer}: authorization read after capture carried no status`);
    }
    return { auth: authStatus, order: str(field(o.json, 'status')) };
  });
  const seen = after as { auth: string; order: string };

  // G1.7 explicit void attempt, G1.8 read again.
  const voided = await ctx.step(key('G1.7 void attempt'), async (): Promise<Json> => {
    const res = await http.request('G1.7 void attempt', {
      method: 'POST',
      path: `/v2/payments/authorizations/${authId}/void`,
      headers: { ...auth, 'PayPal-Request-Id': rid('void') },
    });
    return { http: res.status, name: errorName(res.json) };
  });
  const v = voided as { http: number; name: string };
  const final = await ctx.step(key('G1.8 read after void'), async () => {
    const res = await http.request('G1.8 read after void attempt', {
      method: 'GET',
      path: `/v2/payments/authorizations/${authId}`,
      headers: auth,
    });
    must(res, 200, 'authorization read after void', buyer);
    const status = str(field(res.json, 'status'));
    if (status === '') throw new Error(`G1 ${buyer}: authorization read after void had no status`);
    return status;
  });

  const verdict = decideG1({
    captureHttp: cap.http,
    authStatusAfterCapture: seen.auth,
    voidHttp: v.http,
  });
  const observed: G1Observed = {
    buyer,
    orderId,
    authId,
    authStatusBefore,
    captureHttp: cap.http,
    captureStatus: cap.status,
    captureFinal: cap.final,
    authStatusAfterCapture: seen.auth,
    orderStatusAfterCapture: seen.order,
    voidHttp: v.http,
    voidName: v.name,
    authStatusAfterVoid: final,
    remainderOpen: verdict.remainderOpen,
    decision: verdict.decision,
  };
  http.note('G1.6 observe remainder', 'remainder after final capture', {
    authStatus: observed.authStatusAfterCapture,
    orderStatus: observed.orderStatusAfterCapture,
    remainderOpen: observed.remainderOpen,
  });
  http.note('G1.7 void attempt', 'explicit void result', { http: v.http, name: v.name });
  http.note('G1.8 decision', 'G1 decision (SPEC 7.3)', observed.decision);
  http.setBuyer(undefined);
  return observed;
}

function rowsFor(o: G1Observed): GateRow[] {
  return [
    {
      id: `G1.5 ${o.buyer} capture 350 with final_capture`,
      expected: 'accepted',
      actual: `HTTP ${o.captureHttp} ${o.captureStatus}${o.captureFinal === null ? '' : `, final_capture ${String(o.captureFinal)}`}`,
      verdict: o.captureHttp >= 200 && o.captureHttp < 300 ? 'observed' : 'FAIL',
    },
    {
      id: `G1.6 ${o.buyer} remainder status after final capture`,
      expected: 'open or released',
      actual: `authorization ${o.authStatusAfterCapture}, order ${o.orderStatusAfterCapture}: ${o.remainderOpen ? 'open' : 'released'}`,
      verdict: 'observed',
    },
    {
      id: `G1.7 ${o.buyer} explicit void of the remainder`,
      expected: 'accepted or rejected',
      actual: `HTTP ${o.voidHttp}${o.voidName === '' ? '' : ` ${o.voidName}`}, authorization then ${o.authStatusAfterVoid}`,
      verdict: 'observed',
    },
    {
      id: `G1.8 ${o.buyer} decision`,
      expected: 'A, B or C',
      actual: o.decision,
      verdict: o.decision === 'FAIL' ? 'FAIL' : 'observed',
    },
  ];
}

/** Gate body. */
export async function g1Gate(ctx: GateContext, deps: G1Deps = {}): Promise<void> {
  const token = await fetchAccessToken(
    ctx.http,
    'G1.0 token',
    ctx.config.clientId,
    ctx.config.clientSecret,
  );
  const buyers = deps.buyers ?? (['wallet'] as const);
  const observed: G1Observed[] = [];
  for (const buyer of buyers) {
    const o = await runBuyer(ctx, deps, token, buyer);
    observed.push(o);
    ctx.log(
      `G1 ${buyer}: decision ${o.decision} (authorization ${o.authStatusAfterCapture} after the final capture, explicit void HTTP ${o.voidHttp})`,
    );
  }

  const summary = summarizeDecisions(observed);
  ctx.log(`G1 decision: ${summary.letters}; GATES.md decision ${summary.decision}`);

  const gatesPath = deps.gatesMdPath ?? join(dirname(dirname(ctx.evidencePath)), 'GATES.md');
  if (!existsSync(gatesPath)) writeFileSync(gatesPath, '# Gates\n', 'utf8');
  const sha = process.env['GITHUB_SHA'];
  const entry = withEvidenceHash(
    {
      gate: 'G1',
      title: 'partial capture and remainder',
      runId: ctx.runId,
      operator: process.env['GITHUB_ACTOR'] ?? 'local',
      date: new Date().toISOString().slice(0, 10),
      scriptSha: sha !== undefined && sha !== '' ? sha.slice(0, 7) : G1_SCRIPT_VERSION,
      buyers: observed.map((o) => o.buyer),
      rows: observed.flatMap(rowsFor),
      evidencePath: relative(process.cwd(), ctx.evidencePath) || ctx.evidencePath,
      decision: summary.decision,
      fallback: summary.fallback,
      flippedTags: summary.flippedTags,
    },
    readFileSync(ctx.evidencePath, 'utf8'),
  );
  appendEntry(gatesPath, entry);
  ctx.log(`GATES entry appended to ${gatesPath}`);
}

export interface RunG1Options {
  argv: readonly string[];
  env: Record<string, string | undefined>;
  log?: (message: string) => void;
  /** Tests inject a browser launcher; real runs load Playwright. */
  launcher?: BrowserLauncher;
  sleep?: (ms: number) => Promise<void>;
}

interface G1Flags {
  browser: boolean;
  remainder: 'released' | 'open';
  rest: string[];
}

function parseG1Flags(argv: readonly string[]): G1Flags {
  const flags: G1Flags = { browser: false, remainder: 'released', rest: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] ?? '';
    if (a === '--browser') flags.browser = true;
    else if (a === '--fake-remainder') {
      const v = argv[i + 1];
      if (v !== 'released' && v !== 'open') {
        throw new GateUsageError('--fake-remainder needs released or open');
      }
      flags.remainder = v;
      i += 1;
    } else flags.rest.push(a);
  }
  return flags;
}

/** Entry point. --fake starts the fake PayPal; --browser approves in a headless browser. */
export async function runG1(opts: RunG1Options): Promise<number> {
  const log = opts.log ?? ((m: string) => console.log(m));
  let flags: G1Flags;
  let fake: boolean;
  try {
    flags = parseG1Flags(opts.argv);
    const parsed = parseGateArgs(flags.rest);
    fake = parsed.fake;
  } catch (e) {
    if (e instanceof GateUsageError) {
      log(`refused: ${e.message}`);
      return EXIT_REFUSED;
    }
    throw e;
  }

  const buyers: BuyerLabel[] = ['wallet'];
  if (fake || buyerCredentials(opts.env, 'card') !== undefined) buyers.push('card');

  if (flags.browser && !fake) {
    const missing = missingBuyerSecrets(opts.env);
    if (missing.length > 0) {
      log(
        `refused: missing secret${missing.length > 1 ? 's' : ''} ${missing.join(', ')}. ` +
          'Add them under Settings, Secrets and variables, Actions, then run the workflow again.',
      );
      return EXIT_REFUSED;
    }
  }

  let server: FakePayPalServer | undefined;
  let env = { ...opts.env };
  if (fake) {
    server = new FakePayPalServer({
      core: { autoReleaseRemainder: flags.remainder === 'released' },
    });
    await server.start();
    env = { ...env, PAYPAL_ENV: env['PAYPAL_ENV'] ?? 'sandbox', PAYPAL_BASE_URL: server.url };
  }
  const sha = env['GITHUB_SHA'];
  try {
    return await runGate({
      gate: 'G1',
      scriptVersion: sha !== undefined && sha !== '' ? sha.slice(0, 7) : G1_SCRIPT_VERSION,
      argv: flags.rest,
      env,
      log,
      main: async (ctx) => {
        const deps: G1Deps = { buyers };
        if (opts.sleep !== undefined) deps.sleep = opts.sleep;
        else if (fake) deps.sleep = () => Promise.resolve();
        const srv = server;
        if (srv !== undefined) {
          deps.approve = ({ orderId }) => {
            srv.core.approveOrder(orderId);
            return Promise.resolve();
          };
        } else if (flags.browser) {
          const launcher = opts.launcher ?? (await loadPlaywrightLauncher(env));
          const shotDir = join(dirname(ctx.evidencePath), 'screens');
          const emails: Partial<Record<BuyerLabel, string>> = {};
          for (const b of buyers) {
            const c = buyerCredentials(env, b);
            if (c !== undefined) emails[b] = c.email;
          }
          deps.buyerEmails = emails;
          deps.approve = async ({ approveUrl, buyer }) => {
            const credentials = buyerCredentials(env, buyer);
            if (credentials === undefined) {
              throw new Error(`no credentials configured for the ${buyer} buyer`);
            }
            if (!isSandboxApproveUrl(approveUrl, false)) {
              throw new Error('refusing to open an approval link outside the PayPal sandbox');
            }
            await approveInBrowser({
              approveUrl,
              credentials,
              returnPattern: /example\.com/,
              shotDir,
              shotPrefix: `${ctx.runId}-${buyer}`,
              launcher,
            });
          };
        }
        if (!fake) deps.gatesMdPath = join(dirname(dirname(ctx.evidencePath)), '..', 'GATES.md');
        await g1Gate(ctx, deps);
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
  runG1({ argv: process.argv.slice(2), env: process.env }).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exitCode = 1;
    },
  );
}
