import { join } from 'node:path';
import { approveInBrowser, isSandboxApproveUrl, loadPlaywrightLauncher } from './buyerApproval.js';
import { approveLink, buyerCredentials, errorName, field, firstAuthorization, str } from './gateUtil.js';

/**
 * Sandbox probe of the remainder release. Authorize 500.00 as sandbox buyer A (headless browser),
 * capture 350.00 with final_capture=true, then record PayPal's own answers: GET authorization,
 * GET capture, a void of the closed authorization, a re-GET, and a re-capture of the remaining 150.00.
 * Sandbox only; no money moves. Ids are shown as the last 4 characters; emails and merchant ids are
 * dropped. Secrets and logins are never printed. It does NOT read the buyer's balance.
 */

const BASE = 'https://api-m.sandbox.paypal.com';

const tail = (id: string): string => (id === '' ? '-' : `...${id.slice(-4)}`);
const clip = (s: string, n = 300): string => s.replace(/\s+/g, ' ').slice(0, n);

interface Res {
  status: number;
  json: unknown;
}

const DROP = new Set(['email_address', 'merchant_id', 'payer_id', 'payee', 'name', 'given_name', 'surname']);

/** Copy of the JSON with long ids cut to the last 4 characters and personal fields removed. */
function redact(v: unknown): unknown {
  if (typeof v === 'string') return v.replace(/[A-Za-z0-9]{12,}/g, (m) => `...${m.slice(-4)}`);
  if (Array.isArray(v)) return v.map(redact);
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (!DROP.has(k)) out[k] = redact(val);
    }
    return out;
  }
  return v;
}

async function call(token: string, method: string, path: string, rid: string, body?: unknown): Promise<Res> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(rid === '' ? {} : { 'PayPal-Request-Id': rid }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text === '' ? null : JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

function show(label: string, r: Res): void {
  const name = r.status >= 300 ? ` error=${errorName(r.json) || 'no-error-name'}` : '';
  console.log(`PROBE ${label} HTTP ${r.status}${name}`);
  console.log(`PROBE ${label} body ${clip(JSON.stringify(redact(r.json)), 3000)}`);
}

async function main(): Promise<number> {
  const env = process.env;
  const id = env['PAYPAL_CLIENT_ID'] ?? '';
  const secret = env['PAYPAL_CLIENT_SECRET'] ?? '';
  const creds = buyerCredentials(env, 'wallet');
  if (id === '' || secret === '' || creds === undefined) {
    console.log('refused: missing PayPal or buyer secrets');
    return 2;
  }
  const tokRes = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const tokJson = (await tokRes.json()) as Record<string, unknown>;
  const token = str(tokJson['access_token']);
  if (tokRes.status !== 200 || token === '') {
    console.log(`token request failed with HTTP ${tokRes.status}`);
    return 1;
  }
  const launcher = await loadPlaywrightLauncher(env);
  const run = Date.now().toString(36);
  const rid = (op: string): string => `remainder-${run}-${op}`;
  const shotDir = join(env['RUNNER_TEMP'] ?? '.', 'probe-shots');

  const created = await call(token, 'POST', '/v2/checkout/orders', rid('order'), {
    intent: 'AUTHORIZE',
    purchase_units: [
      { reference_id: `rem-${run}`, custom_id: `rem-${run}`, amount: { currency_code: 'USD', value: '500.00' } },
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
  });
  const orderId = str(field(created.json, 'id'));
  const url = approveLink(created.json);
  console.log(`PROBE create HTTP ${created.status} order=${tail(orderId)}`);
  if (created.status >= 300 || orderId === '' || url === '' || !isSandboxApproveUrl(url, false)) {
    console.log('PROBE stop: order not created or approval link outside sandbox');
    return 1;
  }
  await approveInBrowser({
    approveUrl: url,
    credentials: creds,
    returnPattern: /example\.com/,
    shotDir,
    shotPrefix: 'rem',
    launcher,
  });
  const auth = await call(token, 'POST', `/v2/checkout/orders/${orderId}/authorize`, rid('authorize'));
  const authId = str(firstAuthorization(auth.json)['id']);
  console.log(
    `PROBE authorize HTTP ${auth.status} auth=${tail(authId)} status=${str(firstAuthorization(auth.json)['status'])}`,
  );
  if (authId === '') {
    console.log('PROBE stop: no authorization');
    return 1;
  }
  const ap = `/v2/payments/authorizations/${authId}`;
  show('GET authorization before capture', await call(token, 'GET', ap, ''));

  const cap = await call(token, 'POST', `${ap}/capture`, rid('capture'), {
    amount: { currency_code: 'USD', value: '350.00' },
    final_capture: true,
  });
  const capId = str(field(cap.json, 'id'));
  show('POST capture 350.00 final_capture=true', cap);
  if (capId !== '') show('GET capture', await call(token, 'GET', `/v2/payments/captures/${capId}`, ''));

  show('GET authorization after capture', await call(token, 'GET', ap, ''));
  const v = await call(token, 'POST', `${ap}/void`, rid('void'));
  show('POST void of closed authorization', v);
  show('GET authorization after void attempt', await call(token, 'GET', ap, ''));
  const re = await call(token, 'POST', `${ap}/capture`, rid('recapture'), {
    amount: { currency_code: 'USD', value: '150.00' },
    final_capture: true,
  });
  show('POST re-capture 150.00', re);
  show('GET authorization at the end', await call(token, 'GET', ap, ''));
  console.log('PROBE-DONE (buyer balance not read)');
  return 0;
}

main().then(
  (c) => {
    process.exitCode = c;
  },
  (e: unknown) => {
    console.log(`probe crashed: ${clip(e instanceof Error ? e.message : String(e))}`);
    process.exitCode = 1;
  },
);
