import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
import {
  CHECKPOINTS,
  decideG3,
  dueCheckpoints,
  nextDueMs,
  runCheckpoint,
  toJson,
  type CheckpointId,
  type CheckpointResult,
  type DayZeroState,
  type ImmediateProbe,
} from './g3-timed.js';
import { fetchAccessToken } from './http.js';
import {
  EXIT_REFUSED,
  GateUsageError,
  parseGateArgs,
  runGate,
  type GateContext,
  type Json,
} from './runner.js';
import { appendEntry, withEvidenceHash, type GateRow } from './summarize.js';

/**
 * G3: honor period versus validity, and reauthorize (SPEC R-PAY-145, T-PAY-092).
 *
 * Day 0 run (needs the buyer to approve four orders):
 *   G3.1 an authorization, then an immediate reauthorize attempt (records the error name), then void
 *   G3.2 three authorizations of 5.00, one per checkpoint; the creation time is saved in the run file
 * Later runs, with --resume <run file>, do the checkpoints that are due and then stop:
 *   after 3.5, 4 and 5 days: read, partial capture of 1.00, reauthorize, read again
 * When the three checkpoints are done the run decides (SPEC 7.3) and appends the GATES.md entry.
 *
 * Flags besides the shared ones: --browser (approve in a headless browser on day 0),
 * --fake-after-honor ok|fail (fake only: whether capture after the honor period works).
 * With --fake the whole probe runs at once, the fake clock jumping to each checkpoint.
 *
 * Run with: npm run gate:g3 -w @gavel/payments [-- --fake] [--browser] [--resume <file>]
 */

export const G3_SCRIPT_VERSION = 'g3-1';
export const G3_HOLD_CENTS = 500;

export interface G3Deps {
  approve?: (info: { orderId: string; approveUrl: string; kind: 'wallet' }) => Promise<void>;
  buyerEmail?: string;
  now: () => number;
  gatesMdPath?: string;
}

async function newAuthorization(
  ctx: GateContext,
  deps: G3Deps,
  token: string,
  label: string,
): Promise<string> {
  const auth = { Authorization: `Bearer ${token}` };
  const run = ctx.runId.replace(/[^A-Za-z0-9]/g, '').slice(-14);
  const rid = (op: string): string => `g3-${run}-${label}-${op}`;
  const name = (n: string): string => `${label} ${n}`;
  const fail = (what: string, status: number, json: unknown): Error => {
    const n = errorName(json);
    return new Error(`G3 ${label}: ${what} answered HTTP ${status}${n === '' ? '' : ` (${n})`}`);
  };

  const order = await ctx.step(name('create order'), async (): Promise<Json> => {
    const res = await ctx.http.request(name('create order'), {
      method: 'POST',
      path: '/v2/checkout/orders',
      headers: { ...auth, 'PayPal-Request-Id': rid('order') },
      body: {
        intent: 'AUTHORIZE',
        purchase_units: [
          { reference_id: rid('o'), custom_id: rid('o'), amount: amount(G3_HOLD_CENTS) },
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
    const orderId = str(field(res.json, 'id'));
    const approveUrl = approveLink(res.json);
    if (res.status !== 201 || orderId === '' || approveUrl === '') {
      throw fail('order creation', res.status, res.json);
    }
    return { orderId, approveUrl };
  });
  const orderId = String((order as { orderId: Json }).orderId);
  const approveUrl = String((order as { approveUrl: Json }).approveUrl);

  // A resumed run finds this step done; a run that paused finishes it once the buyer approved.
  await ctx.step(name('approve'), async (): Promise<Json> => {
    if (deps.approve !== undefined) await deps.approve({ orderId, approveUrl, kind: 'wallet' });
    else await ctx.waitForApproval(name('approve'), approveUrl, `${label}, order ${orderId}`);
    return true;
  });

  await ctx.step(name('order after approval'), async (): Promise<Json> => {
    const res = await ctx.http.request(name('order after approval'), {
      method: 'GET',
      path: `/v2/checkout/orders/${orderId}`,
      headers: auth,
    });
    const status = str(field(res.json, 'status'));
    if (res.status !== 200 || status !== 'APPROVED') {
      throw new Error(
        `G3 ${label}: order is ${status === '' ? `HTTP ${res.status}` : status} after approval, expected APPROVED; the buyer did not complete the payment`,
      );
    }
    if (
      deps.buyerEmail !== undefined &&
      comparePayer(payerEmail(res.json), deps.buyerEmail) === 'mismatch'
    ) {
      throw new Error(
        `G3 ${label}: the order was approved by a different account than the configured buyer; use a personal sandbox account in SANDBOX_BUYER_EMAIL`,
      );
    }
    return true;
  });

  return ctx.step(name('authorize'), async (): Promise<string> => {
    const res = await ctx.http.request(name('authorize'), {
      method: 'POST',
      path: `/v2/checkout/orders/${orderId}/authorize`,
      headers: { ...auth, 'PayPal-Request-Id': rid('authorize') },
    });
    const id = str(firstAuthorization(res.json)['id']);
    if (res.status !== 201 || id === '') throw fail('authorize', res.status, res.json);
    return id;
  });
}

function rowsFor(imm: ImmediateProbe, results: readonly CheckpointResult[]): GateRow[] {
  return [
    {
      id: 'G3.1 immediate reauthorize',
      expected: 'accepted or rejected',
      actual: `HTTP ${imm.http}${imm.name === '' ? '' : ` ${imm.name}`}`,
      verdict: 'observed',
    },
    ...results.flatMap((r) => [
      {
        id: `G3.${r.id} capture 1.00 after ${r.id.slice(1)} days`,
        expected: 'accepted or rejected',
        actual: `HTTP ${r.captureHttp}${r.captureName === '' ? '' : ` ${r.captureName}`}, authorization ${r.statusBefore} -> ${r.statusAfter}`,
        verdict: 'observed',
      },
      {
        id: `G3.${r.id} reauthorize after ${r.id.slice(1)} days`,
        expected: 'accepted or rejected',
        actual: `HTTP ${r.reauthHttp}${r.reauthName === '' ? '' : ` ${r.reauthName}`}`,
        verdict: 'observed',
      },
    ]),
  ];
}

/** Gate body: day 0 work when it is not done, then the checkpoints that are due. */
export async function g3Gate(ctx: GateContext, deps: G3Deps): Promise<void> {
  const token = await fetchAccessToken(
    ctx.http,
    'G3.0 token',
    ctx.config.clientId,
    ctx.config.clientSecret,
  );

  // G3.1 immediate reauthorize on a fresh authorization.
  const probeAuth = await newAuthorization(ctx, deps, token, 'G3.1 probe');
  const immediate = (await ctx.step('G3.1 immediate reauthorize', async (): Promise<Json> => {
    const run = ctx.runId.replace(/[^A-Za-z0-9]/g, '').slice(-14);
    const auth = { Authorization: `Bearer ${token}` };
    const re = await ctx.http.request('G3.1 immediate reauthorize', {
      method: 'POST',
      path: `/v2/payments/authorizations/${probeAuth}/reauthorize`,
      headers: { ...auth, 'PayPal-Request-Id': `g3-${run}-probe-reauth` },
      body: { amount: amount(G3_HOLD_CENTS) },
    });
    await ctx.http.request('G3.1 void probe authorization', {
      method: 'POST',
      path: `/v2/payments/authorizations/${probeAuth}/void`,
      headers: { ...auth, 'PayPal-Request-Id': `g3-${run}-probe-void` },
    });
    ctx.http.note('G3.1 immediate reauthorize', 'immediate reauthorize result', {
      http: re.status,
      name: errorName(re.json),
    });
    return { http: re.status, name: errorName(re.json) };
  })) as unknown as ImmediateProbe;

  // G3.2 the three timed authorizations.
  const authIds: Partial<Record<CheckpointId, string>> = {};
  for (const c of CHECKPOINTS) {
    authIds[c.id] = await newAuthorization(ctx, deps, token, `G3.2 ${c.id}`);
  }
  const state = (await ctx.step('G3.2 day 0 state', (): Promise<Json> => {
    const created: DayZeroState = {
      createdMs: deps.now(),
      auths: { 'd3.5': authIds['d3.5'] ?? '', d4: authIds['d4'] ?? '', d5: authIds['d5'] ?? '' },
    };
    return Promise.resolve({ ...created, auths: { ...created.auths } });
  })) as unknown as DayZeroState;

  // Checkpoints that are due. A finished one returns its saved result.
  const now = deps.now();
  const due = dueCheckpoints(state.createdMs, now, []);
  const results: CheckpointResult[] = [];
  for (const id of due) {
    const r = await ctx.step(
      `G3.${id} checkpoint`,
      async (): Promise<Json> =>
        toJson(await runCheckpoint(ctx, token, id, state.auths[id], G3_HOLD_CENTS)),
    );
    results.push(r as unknown as CheckpointResult);
  }

  if (results.length < CHECKPOINTS.length) {
    const next = nextDueMs(
      state.createdMs,
      results.map((r) => r.id),
    );
    const hours = next === undefined ? 0 : Math.max(0, Math.ceil((next - now) / 3_600_000));
    ctx.log(
      `G3 day 0 done; ${results.length} of ${CHECKPOINTS.length} checkpoints run; next in about ${hours} hours. ` +
        `Rerun with --resume ${ctx.runFile}`,
    );
    return;
  }

  await ctx.step('G3.9 entry', (): Promise<Json> => {
    const verdict = decideG3(results);
    ctx.log(`G3 decision: ${verdict.decision}. ${verdict.rule}`);
    const gatesPath = deps.gatesMdPath ?? join(dirname(dirname(ctx.evidencePath)), 'GATES.md');
    if (!existsSync(gatesPath)) writeFileSync(gatesPath, '# Gates\n', 'utf8');
    const sha = process.env['GITHUB_SHA'];
    const entry = withEvidenceHash(
      {
        gate: 'G3',
        title: 'honor period, validity and reauthorize',
        runId: ctx.runId,
        operator: process.env['GITHUB_ACTOR'] ?? 'local',
        date: new Date(deps.now()).toISOString().slice(0, 10),
        scriptSha: sha !== undefined && sha !== '' ? sha.slice(0, 7) : G3_SCRIPT_VERSION,
        buyers: ['wallet'],
        rows: [
          ...rowsFor(immediate, results),
          {
            id: 'G3.9 rule',
            expected: 'PASS, PASS-WITH-FALLBACK or FAIL',
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
    // Tells the scheduled workflow that the probe is finished.
    writeFileSync(join(dirname(ctx.evidencePath), 'complete.marker'), `${ctx.runId}\n`, 'utf8');
    return Promise.resolve(true);
  });
}

export interface RunG3Options {
  argv: readonly string[];
  env: Record<string, string | undefined>;
  log?: (message: string) => void;
  launcher?: BrowserLauncher;
  now?: () => number;
}

interface G3Flags {
  browser: boolean;
  afterHonor: 'ok' | 'fail';
  rest: string[];
}

function parseG3Flags(argv: readonly string[]): G3Flags {
  const flags: G3Flags = { browser: false, afterHonor: 'ok', rest: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] ?? '';
    if (a === '--browser') flags.browser = true;
    else if (a === '--fake-after-honor') {
      const v = argv[i + 1];
      if (v !== 'ok' && v !== 'fail')
        throw new GateUsageError('--fake-after-honor needs ok or fail');
      flags.afterHonor = v;
      i += 1;
    } else flags.rest.push(a);
  }
  return flags;
}

function findRunFile(outRoot: string): string | undefined {
  const dir = join(outRoot, 'G3');
  if (!existsSync(dir)) return undefined;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.run.json'))
    .sort();
  const last = files[files.length - 1];
  return last === undefined ? undefined : join(dir, last);
}

/** Entry point. --fake runs day 0 and the three checkpoints in one go on the fake PayPal. */
export async function runG3(opts: RunG3Options): Promise<number> {
  const log = opts.log ?? ((m: string) => console.log(m));
  let flags: G3Flags;
  let args: ReturnType<typeof parseGateArgs>;
  try {
    flags = parseG3Flags(opts.argv);
    args = parseGateArgs(flags.rest);
  } catch (e) {
    if (e instanceof GateUsageError) {
      log(`refused: ${e.message}`);
      return EXIT_REFUSED;
    }
    throw e;
  }
  const fake = args.fake;

  if (flags.browser && !fake && args.resume === undefined) {
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
  let offsetMs = 0;
  const now = opts.now ?? (() => Date.now() + offsetMs);
  if (fake) {
    server = new FakePayPalServer({ core: { afterHonorCapture: flags.afterHonor } });
    await server.start();
    env = { ...env, PAYPAL_ENV: env['PAYPAL_ENV'] ?? 'sandbox', PAYPAL_BASE_URL: server.url };
  }
  const sha = env['GITHUB_SHA'];
  const scriptVersion = sha !== undefined && sha !== '' ? sha.slice(0, 7) : G3_SCRIPT_VERSION;

  const once = (argv: readonly string[]): Promise<number> =>
    runGate({
      gate: 'G3',
      scriptVersion,
      argv,
      env,
      log,
      now,
      main: async (ctx) => {
        const deps: G3Deps = { now };
        const srv = server;
        if (srv !== undefined) {
          deps.approve = ({ orderId }) => {
            srv.core.approveOrder(orderId);
            return Promise.resolve();
          };
        } else if (flags.browser && args.resume === undefined) {
          const launcher = opts.launcher ?? (await loadPlaywrightLauncher(env));
          const credentials = buyerCredentials(env, 'wallet');
          if (credentials !== undefined) deps.buyerEmail = credentials.email;
          deps.approve = async ({ approveUrl }) => {
            if (credentials === undefined) throw new Error('no buyer credentials configured');
            if (!isSandboxApproveUrl(approveUrl, false)) {
              throw new Error('refusing to open an approval link outside the PayPal sandbox');
            }
            await approveInBrowser({
              approveUrl,
              credentials,
              returnPattern: /example\.com/,
              shotDir: join(dirname(ctx.evidencePath), 'screens'),
              shotPrefix: `${ctx.runId}-wallet`,
              launcher,
            });
          };
        }
        if (!fake) deps.gatesMdPath = join(dirname(dirname(ctx.evidencePath)), '..', 'GATES.md');
        await g3Gate(ctx, deps);
      },
    });

  try {
    const first = await once(flags.rest);
    if (!fake || first !== 0 || server === undefined) return first;
    // Fake: jump to each checkpoint and resume the same run.
    const outRoot = args.out ?? join(tmpdir(), 'gavel-gates');
    const runFile = findRunFile(outRoot);
    if (runFile === undefined) {
      log('refused: the fake run left no run file');
      return EXIT_REFUSED;
    }
    let code = first;
    for (const c of CHECKPOINTS) {
      // Jump to the checkpoint: the fake clock and the script clock move by the same amount.
      server.core.clock.advance(c.afterMs - offsetMs);
      offsetMs = c.afterMs;
      code = await once([...flags.rest, '--resume', runFile]);
      if (code !== 0) return code;
    }
    return code;
  } finally {
    await server?.stop();
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
