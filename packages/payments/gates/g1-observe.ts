import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertSandboxUrl, SANDBOX_API_HOST } from '../src/guard.js';
import { centsToDecimal } from '../src/money.js';
import {
  approveInBrowser,
  HIDE_PAGE_CONTENT_CSS,
  isSandboxApproveUrl,
  loadPlaywrightLauncher,
  missingBuyerSecrets,
  REMOVE_MASK_EXPRESSION,
  type BrowserLauncher,
  type PageLike,
} from './buyerApproval.js';
import {
  amount,
  approveLink,
  buyerCredentials,
  field,
  firstAuthorization,
  str,
} from './gateUtil.js';

/**
 * G1 remainder observation (issue 2187). Gate G1 showed that the authorization closes as CAPTURED
 * after a final capture of 350.00 of 500.00, but never read a buyer balance, so the release of the
 * 150.00 remainder is inferred. This script tries to read it: with one signed-in browser session of
 * a sandbox buyer it reads the buyer's account pages before the authorization, after authorizing 500.00
 * and after capturing 350.00 with final_capture, and reads the authorization and order from the API
 * at each step. Only numbers, statuses and HTTP codes are written. No email, id or page text is stored,
 * and the screenshots hide all text.
 *
 * "observed" is written only with the three numbers that show it (see concludeG1Observation);
 * otherwise the result says "inferred" and why. Sandbox only (assertSandboxUrl).
 *
 * Run with: npm run gate:g1-observe -w @gavel/payments -- --out <dir>   (workflow gate-g1-observe)
 */

export const OBSERVE_AUTHORIZE_CENTS = 50000;
export const OBSERVE_CAPTURE_CENTS = 35000;

export type ObserveStep = 'before-authorize' | 'after-authorize' | 'after-capture';

/** What the buyer's account pages showed at one step. Numbers and flags only. */
export interface BuyerView {
  /** True when an available-funds amount was read from the account summary. */
  readable: boolean;
  /** Available funds in cents (negative allowed), null when not read. */
  availableCents: number | null;
  /** The activity page mentioned pending or an authorization (a flag, no text kept). */
  activityMentionsPending: boolean;
  /** Short fixed reason when not readable. */
  reason: string;
}

export interface ApiView {
  authorizationHttp: number | null;
  authorizationStatus: string;
  orderHttp: number | null;
  orderStatus: string;
}

export interface Reading {
  step: ObserveStep;
  buyer: BuyerView;
  api: ApiView;
}

export interface Conclusion {
  /** "observed" only when the three buyer readings prove the release, else "inferred". */
  status: 'observed' | 'inferred';
  sentence: string;
}

const MONEY = /(-)?(?:US\$|\$|USD\s?)\s?(-?\d{1,3}(?:,\d{3})*(?:\.\d{2})|-?\d+\.\d{2})/g;

/** Amounts written like "$1,234.56" or "USD 12.50" in a text, as cents. */
export function moneyCents(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(MONEY)) {
    const raw = (m[2] ?? '').replace(/,/g, '');
    const negative = m[1] !== undefined || raw.startsWith('-');
    const [whole = '0', frac = '00'] = raw.replace('-', '').split('.');
    const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0').slice(0, 2));
    if (Number.isFinite(cents)) out.push(negative ? -cents : cents);
  }
  return out;
}

/**
 * Available funds from the text of the account summary: the first amount on a line that says
 * balance or available, or on the line after it. Null when no such amount is found.
 */
export function availableFunds(text: string): number | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (!/\b(available|balance)\b/i.test(line)) continue;
    const here = moneyCents(line);
    if (here.length > 0) return here[0] ?? null;
    const next = moneyCents(lines[i + 1] ?? '');
    if (next.length > 0) return next[0] ?? null;
  }
  return null;
}

export function mentionsPending(text: string): boolean {
  return /\b(pending|authori[sz]ation|on hold)\b/i.test(text);
}

/** Whether the page text is a sign-in page rather than the account. */
export function looksSignedOut(url: string, text: string): boolean {
  return (
    /\/signin|\/login|authflow/i.test(url) ||
    /\b(log ?in|sign ?in)\b[\s\S]{0,40}\bpassword\b/i.test(text)
  );
}

export function summarizeView(
  summaryText: string,
  activityText: string,
  signedOut: boolean,
): BuyerView {
  if (signedOut) {
    return {
      readable: false,
      availableCents: null,
      activityMentionsPending: false,
      reason: 'the account pages asked for a sign-in again',
    };
  }
  const availableCents = availableFunds(summaryText);
  return {
    readable: availableCents !== null,
    availableCents,
    activityMentionsPending: mentionsPending(activityText),
    reason: availableCents === null ? 'no available-funds amount found on the account summary' : '',
  };
}

const fmt = (cents: number): string => `${cents < 0 ? '-' : ''}${centsToDecimal(Math.abs(cents))}`;

/**
 * The only place that decides "observed". It needs a readable available-funds figure at all three
 * steps, and:
 *   - after authorizing 500.00 the figure is 500.00 lower than before (the hold is visible), and
 *   - after the final capture of 350.00 it is 350.00 lower than before (the 150.00 came back).
 * Without a visible hold a released remainder cannot be told from one that was never held.
 */
export function concludeG1Observation(readings: readonly Reading[]): Conclusion {
  const at = (s: ObserveStep): Reading | undefined => readings.find((r) => r.step === s);
  const b = at('before-authorize')?.buyer;
  const a = at('after-authorize')?.buyer;
  const c = at('after-capture')?.buyer;
  if (b === undefined || a === undefined || c === undefined) {
    return { status: 'inferred', sentence: 'the run did not reach all three readings' };
  }
  if (b.availableCents === null || a.availableCents === null || c.availableCents === null) {
    const bad = [b, a, c].find((v) => !v.readable);
    return {
      status: 'inferred',
      sentence: `the buyer account pages could not be read at every step (${bad?.reason ?? 'unknown'})`,
    };
  }
  const held = b.availableCents - a.availableCents;
  const spent = b.availableCents - c.availableCents;
  if (held !== OBSERVE_AUTHORIZE_CENTS) {
    return {
      status: 'inferred',
      sentence:
        `available funds went from ${fmt(b.availableCents)} to ${fmt(a.availableCents)} after authorizing ` +
        `${fmt(OBSERVE_AUTHORIZE_CENTS)}, so the buyer view does not show the hold and cannot show its release`,
    };
  }
  if (spent === OBSERVE_CAPTURE_CENTS) {
    return {
      status: 'observed',
      sentence:
        `available funds went from ${fmt(b.availableCents)} to ${fmt(a.availableCents)} while ` +
        `${fmt(OBSERVE_AUTHORIZE_CENTS)} was authorized and to ${fmt(c.availableCents)} after the ` +
        `final capture of ${fmt(OBSERVE_CAPTURE_CENTS)}: the ${fmt(OBSERVE_AUTHORIZE_CENTS - OBSERVE_CAPTURE_CENTS)} remainder was released`,
    };
  }
  return {
    status: 'inferred',
    sentence:
      `available funds went from ${fmt(b.availableCents)} to ${fmt(a.availableCents)} after authorizing and to ` +
      `${fmt(c.availableCents)} after the final capture, which is not the ${fmt(OBSERVE_CAPTURE_CENTS)} the capture took`,
  };
}

export interface ApiReply {
  status: number;
  json: unknown;
}

export interface ObserveDeps {
  request(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    extra?: Record<string, string>,
  ): Promise<ApiReply>;
  /**
   * Signs in as the buyer in a browser, approves the order, and then runs `during` while the
   * session is still open. `read` reads the buyer's account pages now.
   */
  approve(
    approveUrl: string,
    during: (read: () => Promise<BuyerView>) => Promise<void>,
  ): Promise<void>;
  sleep(ms: number): Promise<void>;
  currency: string;
  runTag: string;
}

export interface ObserveResult {
  readings: Reading[];
  conclusion: Conclusion;
  captureHttp: number | null;
  error: string;
}

async function apiView(deps: ObserveDeps, authId: string, orderId: string): Promise<ApiView> {
  const a = await deps.request('GET', `/v2/payments/authorizations/${authId}`);
  const o = await deps.request('GET', `/v2/checkout/orders/${orderId}`);
  return {
    authorizationHttp: a.status,
    authorizationStatus: str(field(a.json, 'status')),
    orderHttp: o.status,
    orderStatus: str(field(o.json, 'status')),
  };
}

/** The whole observation. Never throws: a failure is recorded in `error` with what was read so far. */
export async function observeG1(deps: ObserveDeps): Promise<ObserveResult> {
  const readings: Reading[] = [];
  let captureHttp: number | null = null;
  let error = '';
  try {
    const order = await deps.request(
      'POST',
      '/v2/checkout/orders',
      {
        intent: 'AUTHORIZE',
        purchase_units: [
          {
            reference_id: `g1o-${deps.runTag}`,
            custom_id: `g1o-${deps.runTag}`,
            amount: amount(OBSERVE_AUTHORIZE_CENTS, deps.currency),
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
      { 'PayPal-Request-Id': `g1o-${deps.runTag}-order` },
    );
    const orderId = str(field(order.json, 'id'));
    const approveUrl = approveLink(order.json);
    if (![200, 201].includes(order.status) || orderId === '' || approveUrl === '') {
      throw new Error(
        `order creation answered HTTP ${order.status} without an id or approval link`,
      );
    }
    await deps.approve(approveUrl, async (read) => {
      const none: ApiView = {
        authorizationHttp: null,
        authorizationStatus: '',
        orderHttp: null,
        orderStatus: '',
      };
      const o1 = await deps.request('GET', `/v2/checkout/orders/${orderId}`);
      readings.push({
        step: 'before-authorize',
        buyer: await read(),
        api: { ...none, orderHttp: o1.status, orderStatus: str(field(o1.json, 'status')) },
      });
      const auth = await deps.request(
        'POST',
        `/v2/checkout/orders/${orderId}/authorize`,
        undefined,
        {
          'PayPal-Request-Id': `g1o-${deps.runTag}-authorize`,
        },
      );
      const authId = str(firstAuthorization(auth.json)['id']);
      if (![200, 201].includes(auth.status) || authId === '') {
        throw new Error(`authorize answered HTTP ${auth.status} without an authorization id`);
      }
      await deps.sleep(5000);
      readings.push({
        step: 'after-authorize',
        buyer: await read(),
        api: await apiView(deps, authId, orderId),
      });
      const cap = await deps.request(
        'POST',
        `/v2/payments/authorizations/${authId}/capture`,
        {
          amount: amount(OBSERVE_CAPTURE_CENTS, deps.currency),
          final_capture: true,
          invoice_id: `g1o-${deps.runTag}`,
        },
        { 'PayPal-Request-Id': `g1o-${deps.runTag}-capture` },
      );
      captureHttp = cap.status;
      if (cap.status < 200 || cap.status >= 300) {
        throw new Error(`capture answered HTTP ${cap.status}`);
      }
      // Give the buyer-side pages time to catch up before the last read.
      await deps.sleep(10000);
      readings.push({
        step: 'after-capture',
        buyer: await read(),
        api: await apiView(deps, authId, orderId),
      });
    });
  } catch (e) {
    error = e instanceof Error ? e.message : 'run failed';
  }
  return { readings, conclusion: concludeG1Observation(readings), captureHttp, error };
}

const SUMMARY_URL = 'https://www.sandbox.paypal.com/myaccount/summary';
const ACTIVITY_URL = 'https://www.sandbox.paypal.com/myaccount/activity';

async function pageText(page: PageLike, url: string): Promise<{ text: string; finalUrl: string }> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
  await page.waitForTimeout(2500);
  const text = await page.evaluate('document.body ? document.body.innerText : ""');
  return { text: typeof text === 'string' ? text : '', finalUrl: page.url() };
}

/** Reads the buyer's account summary and activity page; keeps numbers and flags only. */
export async function readBuyerView(
  page: PageLike,
  shotDir: string,
  shotName: string,
): Promise<BuyerView> {
  try {
    const summary = await pageText(page, SUMMARY_URL);
    const signedOut = looksSignedOut(summary.finalUrl, summary.text);
    // Layout-only screenshot: every text, image and field is hidden before the shot.
    try {
      for (const frame of page.frames())
        await frame.addStyleTag({ content: HIDE_PAGE_CONTENT_CSS });
      await page
        .screenshot({ path: join(shotDir, `${shotName}-summary.png`) })
        .catch(() => undefined);
    } finally {
      for (const frame of page.frames())
        await frame.evaluate(REMOVE_MASK_EXPRESSION).catch(() => undefined);
    }
    if (signedOut) return summarizeView('', '', true);
    const activity = await pageText(page, ACTIVITY_URL);
    return summarizeView(summary.text, activity.text, false);
  } catch {
    return {
      readable: false,
      availableCents: null,
      activityMentionsPending: false,
      reason: 'the account pages did not load',
    };
  }
}

export interface RunObserveOptions {
  env: Record<string, string | undefined>;
  outDir: string;
  launcher?: BrowserLauncher;
  fetchFn?: typeof fetch;
  log?: (line: string) => void;
}

/** Entry point; returns the exit code. 0 means the run completed, whatever it found. */
export async function runObserve(opts: RunObserveOptions): Promise<number> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const env = opts.env;
  const missing = [
    ...['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET'].filter((k) => (env[k] ?? '').trim() === ''),
    ...missingBuyerSecrets(env),
  ];
  if (missing.length > 0) {
    log(`refused: missing secret${missing.length > 1 ? 's' : ''} ${missing.join(', ')}`);
    return 2;
  }
  if (env['PAYPAL_ENV'] !== 'sandbox') {
    log('refused: PAYPAL_ENV must be sandbox');
    return 2;
  }
  const credentials = buyerCredentials(env, 'wallet');
  if (credentials === undefined) {
    log('refused: wallet buyer credentials missing');
    return 2;
  }
  const base = assertSandboxUrl(`https://${SANDBOX_API_HOST}`, { fake: false }).origin;
  const doFetch = opts.fetchFn ?? fetch;
  const shotDir = join(opts.outDir, 'screens');
  mkdirSync(shotDir, { recursive: true });
  const launcher = opts.launcher ?? (await loadPlaywrightLauncher(env));
  const runTag = new Date()
    .toISOString()
    .replace(/[^0-9]/g, '')
    .slice(2, 14);

  const basic = Buffer.from(
    `${env['PAYPAL_CLIENT_ID']}:${env['PAYPAL_CLIENT_SECRET']}`,
    'utf8',
  ).toString('base64');
  const tokenRes = await doFetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const tokenJson: unknown = await tokenRes.json().catch(() => undefined);
  const token = str(field(tokenJson, 'access_token'));
  if (tokenRes.status !== 200 || token === '') {
    log(`token request failed with HTTP ${tokenRes.status}`);
    return 1;
  }

  const deps: ObserveDeps = {
    currency: (env['GATE_CURRENCY'] ?? 'USD').trim().toUpperCase() || 'USD',
    runTag,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    request: async (method, path, body, extra) => {
      const res = await doFetch(`${base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(extra ?? {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const json: unknown = await res.json().catch(() => undefined);
      return { status: res.status, json };
    },
    approve: async (approveUrl, during) => {
      if (!isSandboxApproveUrl(approveUrl, false)) {
        throw new Error('refusing to open an approval link outside the PayPal sandbox');
      }
      let inner: Error | undefined;
      await approveInBrowser({
        approveUrl,
        credentials,
        returnPattern: /example\.com/,
        shotDir,
        shotPrefix: `g1o-${runTag}`,
        launcher,
        afterReturn: async (page) => {
          let n = 0;
          try {
            await during(() => {
              n += 1;
              return readBuyerView(page, shotDir, `read${n}`);
            });
          } catch (e) {
            inner = e instanceof Error ? e : new Error('observation failed');
          }
        },
      });
      if (inner !== undefined) throw inner;
    },
  };

  const result = await observeG1(deps);
  const doc = {
    script: 'g1-observe-1',
    runTag,
    authorizeCents: OBSERVE_AUTHORIZE_CENTS,
    captureCents: OBSERVE_CAPTURE_CENTS,
    captureHttp: result.captureHttp,
    readings: result.readings,
    conclusion: result.conclusion,
    error: result.error,
  };
  writeFileSync(join(opts.outDir, 'g1-observe.json'), `${JSON.stringify(doc, null, 2)}\n`);
  const md = [
    '### G1 remainder observation',
    '',
    `Result: ${result.conclusion.status}. ${result.conclusion.sentence}.`,
    ...(result.error === '' ? [] : ['', `Run error: ${result.error}`]),
    '',
    '| step | available funds | readable | order | authorization |',
    '| --- | --- | --- | --- | --- |',
    ...result.readings.map(
      (r) =>
        `| ${r.step} | ${r.buyer.availableCents === null ? 'not read' : fmt(r.buyer.availableCents)} | ${r.buyer.readable ? 'yes' : `no (${r.buyer.reason})`} | ${r.api.orderStatus || '-'} | ${r.api.authorizationStatus || '-'} |`,
    ),
    '',
  ].join('\n');
  writeFileSync(join(opts.outDir, 'g1-observe.md'), md);
  log(md);
  return 0;
}

// vite-node drops the script from argv, so its own binary name marks the entry run.
const isEntry =
  /vite-node/.test(process.argv[1] ?? '') ||
  process.argv.slice(1).some((a) => pathToFileURL(resolve(a)).href === import.meta.url);
if (isEntry) {
  const i = process.argv.indexOf('--out');
  const outDir = i >= 0 ? (process.argv[i + 1] ?? 'g1-observe-out') : 'g1-observe-out';
  runObserve({ env: process.env, outDir }).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exitCode = 1;
    },
  );
}
