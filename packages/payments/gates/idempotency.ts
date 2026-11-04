import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FakePayPalServer } from '../src/fake/server.js';
import { fetchAccessToken, type GateResponse } from './http.js';
import {
  EXIT_REFUSED,
  GateUsageError,
  parseGateArgs,
  runGate,
  type GateContext,
  type Json,
} from './runner.js';

/**
 * Sandbox idempotency probe (SPEC R-PAY-013, T-PAY-095).
 *
 * Observes how PayPal treats the `PayPal-Request-Id` header and records it, so
 * the UNVERIFIED tags on R-PAY-013, R-PAY-123 and the assumptions I01 to I04 in
 * src/fake/ASSUMPTIONS.md can be flipped from evidence:
 *
 *   1. capture with request id A (partial, not final)
 *   2. the same capture again with id A        -> replay of the first, or a second capture?
 *   3. the same body with a different id B     -> a second capture, or an error?
 *   4. id A again with a different amount      -> conflict error, and which name?
 *   5. order creation with request ids of 36, 64, 65, 100 and 128 characters
 *      -> which length is the first one refused?
 *
 * Nothing here asserts a PayPal behaviour: every outcome is recorded as an
 * observation (an evidence record with pass = true) and printed as a table. The
 * script fails only when it cannot complete the probe. Retention of request ids
 * over time is not probed (needs a run on a later day); it stays UNVERIFIED.
 *
 * Long ids contain a "." every 20 characters: the evidence lint rejects 40
 * character word-like strings as possible credentials. UNVERIFIED (IDEM): that
 * PayPal accepts "." in the id; a refusal at every length would point to the
 * character set rather than the length, and the table shows it.
 *
 * Run with: npm run gate:idem -w @gavel/payments [-- --fake] [--resume <file>]
 * In the sandbox the run pauses once (exit 3) so a buyer can approve the order.
 */

export const IDEMPOTENCY_SCRIPT_VERSION = 'idempotency-1';
export const LENGTH_PROBES = [36, 64, 65, 100, 128] as const;

export interface IdempotencyDeps {
  /** Fake runs only: approves an order the way the buyer would. */
  approveOrder?: (orderId: string) => void;
}

export interface Observed {
  orderId: string;
  authId: string;
  firstCapture: { status: number; id: string };
  sameIdSameBody: { status: number; id: string; replayedFirst: boolean };
  differentId: { status: number; id: string; createdSecondCapture: boolean };
  sameIdOtherAmount: { status: number; name: string; issue: string };
  /** Request id length -> HTTP status of the order creation. */
  lengths: Record<string, number>;
  /** Largest probed length that was accepted (2xx), 0 when none. */
  largestAccepted: number;
  /** First probed length that was refused, 0 when none. */
  firstRefused: number;
}

/** A request id of exactly `length` characters, a "." after every 20. Pure. */
export function longRequestId(length: number, seed: string): string {
  let out = '';
  let i = 0;
  while (out.length < length) {
    out += out.length % 21 === 20 ? '.' : (seed[i % seed.length] ?? 'x');
    i += 1;
  }
  return out.slice(0, length);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function errorNames(json: unknown): { name: string; issue: string } {
  if (!isRecord(json)) return { name: '', issue: '' };
  const details = Array.isArray(json['details']) ? json['details'] : [];
  const first = isRecord(details[0]) ? details[0] : {};
  return { name: str(json['name']), issue: str(first['issue']) };
}

function idOf(res: GateResponse): string {
  return isRecord(res.json) ? str(res.json['id']) : '';
}

function approveLink(json: unknown): string {
  if (!isRecord(json) || !Array.isArray(json['links'])) return '';
  for (const l of json['links']) {
    if (isRecord(l) && l['rel'] === 'approve') return str(l['href']);
  }
  return '';
}

const AMOUNT = (value: string): { currency_code: string; value: string } => ({
  currency_code: 'USD',
  value,
});

/** Gate body. */
export async function idempotencyGate(ctx: GateContext, deps: IdempotencyDeps): Promise<void> {
  const token = await fetchAccessToken(
    ctx.http,
    'idem.0 token',
    ctx.config.clientId,
    ctx.config.clientSecret,
  );
  const auth = { Authorization: `Bearer ${token}` };
  // Per-run prefix so that request ids differ between runs.
  const run = ctx.runId.replace(/[^A-Za-z0-9]/g, '').slice(-12);
  const ids = {
    order: `idem-${run}-order`,
    authorize: `idem-${run}-auth`,
    a: `idem-${run}-cap-a`,
    b: `idem-${run}-cap-b`,
    void: `idem-${run}-void`,
  };

  // Step 1: order. Step 2: buyer approval. Step 3: authorize.
  const order = await ctx.step('idem.1 create order', async (): Promise<Json> => {
    const res = await ctx.http.request('idem.1 create order', {
      method: 'POST',
      path: '/v2/checkout/orders',
      headers: { ...auth, 'PayPal-Request-Id': ids.order },
      body: {
        intent: 'AUTHORIZE',
        purchase_units: [
          {
            reference_id: `idem-${run}`,
            custom_id: `idem-${run}`,
            amount: AMOUNT('5.00'),
          },
        ],
      },
    });
    if (res.status !== 201) throw new Error(`order creation answered ${res.status}`);
    return { orderId: idOf(res), approveUrl: approveLink(res.json) };
  });
  const orderId = String((order as { orderId: Json }).orderId);
  const approveUrl = String((order as { approveUrl: Json }).approveUrl);

  if (deps.approveOrder !== undefined) deps.approveOrder(orderId);
  else await ctx.waitForApproval('idem.2 approve order', approveUrl, `order ${orderId}`);

  const authId = await ctx.step('idem.3 authorize', async (): Promise<string> => {
    const res = await ctx.http.request('idem.3 authorize', {
      method: 'POST',
      path: `/v2/checkout/orders/${orderId}/authorize`,
      headers: { ...auth, 'PayPal-Request-Id': ids.authorize },
    });
    if (res.status !== 201) throw new Error(`authorize answered ${res.status}`);
    const units =
      isRecord(res.json) && Array.isArray(res.json['purchase_units'])
        ? res.json['purchase_units']
        : [];
    const unit = isRecord(units[0]) ? units[0] : {};
    const payments = isRecord(unit['payments']) ? unit['payments'] : {};
    const list = Array.isArray(payments['authorizations']) ? payments['authorizations'] : [];
    const id = isRecord(list[0]) ? str(list[0]['id']) : '';
    if (id === '') throw new Error('authorize answered without an authorization id');
    return id;
  });

  const capture = (step: string, requestId: string, value: string): Promise<GateResponse> =>
    ctx.http.request(step, {
      method: 'POST',
      path: `/v2/payments/authorizations/${authId}/capture`,
      headers: { ...auth, 'PayPal-Request-Id': requestId },
      body: { amount: AMOUNT(value), final_capture: false, invoice_id: `idem-${run}` },
    });

  // Steps 4 to 7: the capture probes.
  const probes = await ctx.step('idem.4 capture probes', async (): Promise<Json> => {
    const first = await capture('idem.4 capture A', ids.a, '1.00');
    const again = await capture('idem.5 capture A again, same body', ids.a, '1.00');
    const other = await capture('idem.6 capture B, same body', ids.b, '1.00');
    const conflict = await capture('idem.7 capture A, other amount', ids.a, '2.00');
    const names = errorNames(conflict.json);
    return {
      first: { status: first.status, id: idOf(first) },
      again: { status: again.status, id: idOf(again) },
      other: { status: other.status, id: idOf(other) },
      conflict: { status: conflict.status, name: names.name, issue: names.issue },
    };
  });
  const p = probes as unknown as {
    first: { status: number; id: string };
    again: { status: number; id: string };
    other: { status: number; id: string };
    conflict: { status: number; name: string; issue: string };
  };

  // Step 8: clean up the authorization so the sandbox is left tidy.
  await ctx.step('idem.8 void', async (): Promise<number> => {
    const res = await ctx.http.request('idem.8 void authorization', {
      method: 'POST',
      path: `/v2/payments/authorizations/${authId}/void`,
      headers: { ...auth, 'PayPal-Request-Id': ids.void },
    });
    return res.status;
  });

  // Step 9: request id length probe on order creation.
  const lengths = await ctx.step('idem.9 length probe', async (): Promise<Json> => {
    const out: Record<string, number> = {};
    for (const length of LENGTH_PROBES) {
      const res = await ctx.http.request(`idem.9 request id of ${length} characters`, {
        method: 'POST',
        path: '/v2/checkout/orders',
        headers: { ...auth, 'PayPal-Request-Id': longRequestId(length, `${run}abc`) },
        body: {
          intent: 'AUTHORIZE',
          purchase_units: [
            {
              reference_id: `idem-${run}-len-${length}`,
              custom_id: `idem-${run}-len-${length}`,
              amount: AMOUNT('1.00'),
            },
          ],
        },
      });
      out[String(length)] = res.status;
    }
    return out;
  });
  const lengthStatus = lengths as Record<string, number>;

  const accepted = LENGTH_PROBES.filter((l) => {
    const s = lengthStatus[String(l)] ?? 0;
    return s >= 200 && s < 300;
  });
  const refused = LENGTH_PROBES.filter((l) => {
    const s = lengthStatus[String(l)] ?? 0;
    return s < 200 || s >= 300;
  });
  const observed: Observed = {
    orderId,
    authId,
    firstCapture: p.first,
    sameIdSameBody: {
      status: p.again.status,
      id: p.again.id,
      replayedFirst: p.again.id !== '' && p.again.id === p.first.id,
    },
    differentId: {
      status: p.other.status,
      id: p.other.id,
      createdSecondCapture: p.other.id !== '' && p.other.id !== p.first.id,
    },
    sameIdOtherAmount: p.conflict,
    lengths: lengthStatus,
    largestAccepted: accepted.length === 0 ? 0 : Math.max(...accepted),
    firstRefused: refused.length === 0 ? 0 : Math.min(...refused),
  };

  // Observations, one evidence record each.
  ctx.http.note(
    'idem.5 capture A again, same body',
    'replayed the first capture',
    observed.sameIdSameBody,
  );
  ctx.http.note('idem.6 capture B, same body', 'created a second capture', observed.differentId);
  ctx.http.note(
    'idem.7 capture A, other amount',
    'error for reused id with other params',
    observed.sameIdOtherAmount,
  );
  ctx.http.note('idem.9 length probe', 'status by request id length', {
    lengths: observed.lengths,
    largestAccepted: observed.largestAccepted,
    firstRefused: observed.firstRefused,
  });

  ctx.log(renderObservations(observed));
}

/** Plain-text table of what was observed and which spec tags it speaks to. */
export function renderObservations(o: Observed): string {
  const rows = [
    '| probe | observed | speaks to |',
    '|-------|----------|-----------|',
    `| same id, same body | HTTP ${o.sameIdSameBody.status}, ${o.sameIdSameBody.replayedFirst ? 'replay of the first capture' : 'not a replay'} | R-PAY-013, R-PAY-123, I01 |`,
    `| different id, same body | HTTP ${o.differentId.status}, ${o.differentId.createdSecondCapture ? 'second capture created' : 'no second capture'} | R-PAY-013, I05 |`,
    `| same id, other amount | HTTP ${o.sameIdOtherAmount.status} ${o.sameIdOtherAmount.name} ${o.sameIdOtherAmount.issue} | R-PAY-123, I02 |`,
    `| id length | accepted up to ${o.largestAccepted || 'none'}, first refused ${o.firstRefused || 'none'} (probed ${LENGTH_PROBES.join(', ')}) | R-PAY-013, I04 |`,
  ];
  return rows.join('\n');
}

export interface RunIdempotencyOptions {
  argv: readonly string[];
  env: Record<string, string | undefined>;
  log?: (message: string) => void;
}

/** Entry point. With --fake it starts the fake PayPal server for the run. */
export async function runIdempotency(opts: RunIdempotencyOptions): Promise<number> {
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
      gate: 'idempotency',
      scriptVersion: sha !== undefined && sha !== '' ? sha.slice(0, 7) : IDEMPOTENCY_SCRIPT_VERSION,
      argv: opts.argv,
      env,
      log,
      main: (ctx) => {
        const srv = server;
        return idempotencyGate(
          ctx,
          srv !== undefined ? { approveOrder: (id: string) => srv.core.approveOrder(id) } : {},
        );
      },
    });
  } finally {
    await server?.stop();
  }
}

// Runs when the file is the script being executed (node or vite-node), not when imported.
const isEntry = process.argv
  .slice(1)
  .some((a) => pathToFileURL(resolve(a)).href === import.meta.url);
if (isEntry) {
  runIdempotency({ argv: process.argv.slice(2), env: process.env }).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exitCode = 1;
    },
  );
}
