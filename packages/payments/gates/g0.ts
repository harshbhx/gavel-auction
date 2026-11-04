import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FakePayPalServer } from '../src/fake/server.js';
import { approveLink, field, gateCurrency, isRecord, str } from './gateUtil.js';
import { fetchAccessToken } from './http.js';
import { runGate } from './runner.js';
import type { GateContext } from './runner.js';

/**
 * Gate G0: the sandbox credentials work and an AUTHORIZE order can be created.
 * Runs through runGate, so the sandbox guard is applied and every call is written
 * as an evidence record. The amount uses GATE_CURRENCY (default USD).
 */

export const G0_SCRIPT_VERSION = 'g0-1';

export async function g0Gate(ctx: GateContext): Promise<void> {
  const token = await fetchAccessToken(
    ctx.http,
    'g0.1 token',
    ctx.config.clientId,
    ctx.config.clientSecret,
  );
  const auth = { Authorization: `Bearer ${token}` };
  const run = ctx.runId.replace(/[^A-Za-z0-9]/g, '').slice(-12);
  const created = await ctx.http.request('g0.2 create order', {
    method: 'POST',
    path: '/v2/checkout/orders',
    headers: { ...auth, 'PayPal-Request-Id': `g0-${run}` },
    body: {
      intent: 'AUTHORIZE',
      purchase_units: [
        {
          reference_id: `g0-${run}`,
          custom_id: `g0-${run}`,
          amount: { currency_code: gateCurrency(), value: '5.00' },
        },
      ],
    },
  });
  const orderId = str(field(created.json, 'id'));
  const status = str(field(created.json, 'status'));
  ctx.check('g0.2 create order', 'status is 201', 201, created.status);
  ctx.check(
    'g0.2 create order',
    'order is CREATED or PAYER_ACTION_REQUIRED',
    true,
    status === 'CREATED' || status === 'PAYER_ACTION_REQUIRED',
  );
  ctx.check('g0.2 create order', 'approve link present', true, approveLink(created.json) !== '');
  if (orderId === '') return;
  // The create response may be minimal, so the intent is read back with a GET.
  const back = await ctx.http.request('g0.3 read order', {
    method: 'GET',
    path: `/v2/checkout/orders/${encodeURIComponent(orderId)}`,
    headers: auth,
  });
  const intent = isRecord(back.json) ? str(back.json['intent']) : '';
  ctx.check('g0.3 read order', 'intent is AUTHORIZE', 'AUTHORIZE', intent);
}

export interface G0Options {
  argv: readonly string[];
  env: Record<string, string | undefined>;
  log?: (message: string) => void;
}

export async function runG0(opts: G0Options): Promise<number> {
  const fake = opts.argv.includes('--fake');
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
      gate: 'g0',
      scriptVersion: sha !== undefined && sha !== '' ? sha.slice(0, 7) : G0_SCRIPT_VERSION,
      argv: opts.argv,
      env,
      ...(opts.log !== undefined ? { log: opts.log } : {}),
      main: (ctx) => g0Gate(ctx),
    });
  } finally {
    await server?.stop();
  }
}

// Runs when the file is the script being executed (node or vite-node), not when imported.
const isEntry =
  /vite-node/.test(process.argv[1] ?? '') ||
  process.argv.slice(1).some((a) => pathToFileURL(resolve(a)).href === import.meta.url);
if (isEntry) {
  runG0({ argv: process.argv.slice(2), env: process.env }).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exitCode = 1;
    },
  );
}
