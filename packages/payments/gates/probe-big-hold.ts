import { join } from 'node:path';
import { approveInBrowser, isSandboxApproveUrl, loadPlaywrightLauncher } from './buyerApproval.js';
import { approveLink, buyerCredentials, errorName, field, firstAuthorization, str } from './gateUtil.js';

/**
 * Sandbox probe: does PayPal accept AUTHORIZE holds above 100,000 USD?
 * For each amount: create an AUTHORIZE order, approve it as sandbox buyer A in a headless browser,
 * authorize, record HTTP status and error, then void the authorization. Sandbox only; no money moves.
 * Ids are shown as the last 4 characters. Secrets and logins are never printed.
 */

const BASE = 'https://api-m.sandbox.paypal.com';
const AMOUNTS = ['99999.00', '100001.00', '250000.00', '1000000.00'];

const tail = (id: string): string => (id === '' ? '-' : `...${id.slice(-4)}`);
const clip = (s: string, n = 200): string => s.replace(/\s+/g, ' ').slice(0, n);

interface Res {
  status: number;
  json: unknown;
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

function err(r: Res): string {
  const d = field(r.json, 'details');
  const desc = Array.isArray(d) && d[0] !== undefined ? str(field(d[0], 'description')) : '';
  return `${errorName(r.json) || 'no-error-name'}${desc === '' ? '' : ` | ${clip(desc)}`}`;
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
  const shotDir = join(env['RUNNER_TEMP'] ?? '.', 'probe-shots');
  const rows: string[] = [];
  let unvoided = 0;

  for (const value of AMOUNTS) {
    const row: Record<string, string> = { amount: value };
    const rid = (op: string): string => `probe-${run}-${value.replace('.', '')}-${op}`;
    let authId = '';
    try {
      const created = await call(token, 'POST', '/v2/checkout/orders', rid('order'), {
        intent: 'AUTHORIZE',
        purchase_units: [
          { reference_id: `probe-${run}`, custom_id: `probe-${run}`, amount: { currency_code: 'USD', value } },
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
      row['create'] = `HTTP ${created.status} ${str(field(created.json, 'status'))} ${created.status >= 300 ? err(created) : ''}`.trim();
      const orderId = str(field(created.json, 'id'));
      const url = approveLink(created.json);
      if (created.status >= 300 || orderId === '' || url === '') throw new Error('stop: order not created');
      row['order'] = tail(orderId);
      if (!isSandboxApproveUrl(url, false)) throw new Error('stop: approval link outside sandbox');
      try {
        await approveInBrowser({
          approveUrl: url,
          credentials: creds,
          returnPattern: /example\.com/,
          shotDir,
          shotPrefix: `p-${value.replace('.00', '')}`,
          launcher,
        });
        row['approve'] = 'browser reached return url';
      } catch (e) {
        row['approve'] = `FAILED ${clip(e instanceof Error ? e.message : String(e), 300)}`;
        throw new Error('stop: approval failed');
      }
      const ord = await call(token, 'GET', `/v2/checkout/orders/${orderId}`, '');
      row['orderAfterApprove'] = `HTTP ${ord.status} ${str(field(ord.json, 'status'))}`;
      const auth = await call(token, 'POST', `/v2/checkout/orders/${orderId}/authorize`, rid('authorize'));
      authId = str(firstAuthorization(auth.json)['id']);
      row['authorize'] = `HTTP ${auth.status} order=${str(field(auth.json, 'status'))} auth=${str(firstAuthorization(auth.json)['status'])} ${auth.status >= 300 ? err(auth) : ''}`.trim();
      if (authId !== '') row['auth'] = tail(authId);
    } catch (e) {
      row['note'] = clip(e instanceof Error ? e.message : String(e));
    }
    if (authId !== '') {
      const v = await call(token, 'POST', `/v2/payments/authorizations/${authId}/void`, rid('void'));
      const after = await call(token, 'GET', `/v2/payments/authorizations/${authId}`, '');
      const st = str(field(after.json, 'status'));
      row['void'] = `HTTP ${v.status} ${v.status >= 300 ? err(v) : ''} authStatusAfter=${st}`.trim();
      if (st !== 'VOIDED') unvoided += 1;
    }
    const line = `PROBE amount=${value} USD ` + Object.entries(row).filter(([k]) => k !== 'amount').map(([k, v]) => `${k}=[${v}]`).join(' ');
    console.log(line);
    rows.push(line);
  }
  console.log(`PROBE-DONE unvoided=${unvoided}`);
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
