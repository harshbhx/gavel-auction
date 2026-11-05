import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  approveInBrowser,
  isSandboxApproveUrl,
  loadPlaywrightLauncher,
  missingBuyerSecrets,
  type BrowserLauncher,
} from './buyerApproval.js';
import {
  amount,
  approveLink,
  buyerCredentials,
  field,
  firstAuthorization,
  gateCurrency,
  str,
} from './gateUtil.js';
import { fetchAccessToken } from './http.js';
import { EXIT_REFUSED, parseGateArgs, runGate, type GateContext, type Json } from './runner.js';

/**
 * G4 event generator: drives two small sandbox flows so PayPal sends real webhooks to the
 * receiver (tools/g4-receiver):
 *   1. AUTHORIZE order, buyer approval, authorize, capture  -> PAYMENT.CAPTURE.COMPLETED
 *   2. AUTHORIZE order, buyer approval, authorize, void     -> PAYMENT.AUTHORIZATION.VOIDED
 * The deliveries are read from the receiver afterwards and checked by gates/g4.ts.
 *
 * Run with: npm run gate:g4-events -w @gavel/payments -- [--out <dir>]
 */

export const G4_EVENTS_SCRIPT_VERSION = 'g4e-1';
export const G4_EVENTS_CENTS = 100;

export type G4Flow = 'capture' | 'void';

const OK: readonly number[] = [200, 201];
// PayPal answers 204 No Content when an authorization is voided.
const VOID_OK: readonly number[] = [200, 201, 204];

export interface G4EventsDeps {
  currency?: string;
  approve: (info: { orderId: string; approveUrl: string; flow: G4Flow }) => Promise<void>;
}

function need(status: number, what: string, flow: G4Flow, ok: readonly number[] = OK): void {
  if (!ok.includes(status)) throw new Error(`G4 events ${flow}: ${what} answered HTTP ${status}`);
}

async function runFlow(
  ctx: GateContext,
  deps: G4EventsDeps,
  token: string,
  flow: G4Flow,
): Promise<void> {
  const http = ctx.http;
  http.setBuyer('wallet');
  const auth = { Authorization: `Bearer ${token}` };
  const run = ctx.runId.replace(/[^A-Za-z0-9]/g, '').slice(-14);
  const rid = (op: string): string => `g4e-${run}-${flow}-${op}`;
  const key = (name: string): string => `${flow}/${name}`;

  const order = await ctx.step(key('create order'), async (): Promise<Json> => {
    const res = await http.request(`G4.${flow} create order`, {
      method: 'POST',
      path: '/v2/checkout/orders',
      headers: { ...auth, 'PayPal-Request-Id': rid('order') },
      body: {
        intent: 'AUTHORIZE',
        purchase_units: [
          {
            reference_id: `g4e-${run}-${flow}`,
            custom_id: `g4e-${run}-${flow}`,
            amount: amount(G4_EVENTS_CENTS, deps.currency),
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
    need(res.status, 'order creation', flow);
    const id = str(field(res.json, 'id'));
    const link = approveLink(res.json);
    if (id === '' || link === '')
      throw new Error(`G4 events ${flow}: no order id or approval link`);
    return { orderId: id, approveUrl: link };
  });
  const orderId = String((order as { orderId: Json }).orderId);
  const approveUrl = String((order as { approveUrl: Json }).approveUrl);

  await ctx.step(key('approve'), async (): Promise<Json> => {
    await deps.approve({ orderId, approveUrl, flow });
    http.note(`G4.${flow} approve order`, 'buyer approval finished', 'wallet');
    return true;
  });

  const authId = await ctx.step(key('authorize'), async (): Promise<string> => {
    const res = await http.request(`G4.${flow} authorize`, {
      method: 'POST',
      path: `/v2/checkout/orders/${orderId}/authorize`,
      headers: { ...auth, 'PayPal-Request-Id': rid('authorize') },
    });
    need(res.status, 'authorize', flow);
    const id = str(firstAuthorization(res.json)['id']);
    if (id === '')
      throw new Error(`G4 events ${flow}: authorize answered without an authorization id`);
    return id;
  });

  await ctx.step(key(flow), async (): Promise<Json> => {
    const res =
      flow === 'capture'
        ? await http.request('G4.capture', {
            method: 'POST',
            path: `/v2/payments/authorizations/${authId}/capture`,
            headers: { ...auth, 'PayPal-Request-Id': rid('capture') },
            body: {
              amount: amount(G4_EVENTS_CENTS, deps.currency),
              final_capture: true,
              invoice_id: `g4e-${run}-capture`,
            },
          })
        : await http.request('G4.void', {
            method: 'POST',
            path: `/v2/payments/authorizations/${authId}/void`,
            headers: { ...auth, 'PayPal-Request-Id': rid('void') },
          });
    // The void answers 204 with an empty body, so the body is never parsed here.
    need(res.status, flow, flow, flow === 'void' ? VOID_OK : OK);
    return res.status;
  });
  ctx.log(`G4 events: ${flow} flow done`);
}

/** Gate body. */
export async function g4EventsGate(ctx: GateContext, deps: G4EventsDeps): Promise<void> {
  const token = await fetchAccessToken(
    ctx.http,
    'G4.0 token',
    ctx.config.clientId,
    ctx.config.clientSecret,
  );
  await runFlow(ctx, deps, token, 'capture');
  await runFlow(ctx, deps, token, 'void');
}

export interface RunG4EventsOptions {
  argv: readonly string[];
  env: Record<string, string | undefined>;
  log?: (message: string) => void;
  launcher?: BrowserLauncher;
}

export async function runG4Events(opts: RunG4EventsOptions): Promise<number> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const env = opts.env;
  if (parseGateArgs(opts.argv).fake) {
    log('refused: this script talks to the real sandbox only');
    return EXIT_REFUSED;
  }
  const missing = missingBuyerSecrets(env);
  if (missing.length > 0) {
    log(`refused: missing secret${missing.length > 1 ? 's' : ''} ${missing.join(', ')}`);
    return EXIT_REFUSED;
  }
  const sha = env['GITHUB_SHA'];
  return runGate({
    gate: 'G4-EVENTS',
    scriptVersion: sha !== undefined && sha !== '' ? sha.slice(0, 7) : G4_EVENTS_SCRIPT_VERSION,
    argv: opts.argv,
    env,
    log,
    main: async (ctx) => {
      const launcher = opts.launcher ?? (await loadPlaywrightLauncher(env));
      const credentials = buyerCredentials(env, 'wallet');
      if (credentials === undefined) throw new Error('no wallet buyer credentials configured');
      const shotDir = join(dirname(ctx.evidencePath), 'screens');
      await g4EventsGate(ctx, {
        currency: gateCurrency(env),
        approve: async ({ approveUrl, flow }) => {
          if (!isSandboxApproveUrl(approveUrl, false)) {
            throw new Error('refusing to open an approval link outside the PayPal sandbox');
          }
          await approveInBrowser({
            approveUrl,
            credentials,
            returnPattern: /example\.com/,
            shotDir,
            shotPrefix: `${ctx.runId}-${flow}`,
            launcher,
          });
        },
      });
    },
  });
}

const isEntry =
  /vite-node/.test(process.argv[1] ?? '') ||
  process.argv.slice(1).some((a) => pathToFileURL(resolve(a)).href === import.meta.url);
if (isEntry) {
  runG4Events({ argv: process.argv.slice(2), env: process.env }).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exitCode = 1;
    },
  );
}
