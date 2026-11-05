import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  approveInBrowser,
  loadPlaywrightLauncher,
  type BrowserLauncher,
} from '../../../payments/gates/buyerApproval.js';
import type { EvidenceRecord } from '../../../payments/gates/evidence.js';
import {
  amount,
  approveLink,
  buyerCredentials,
  field,
  firstAuthorization,
  str,
} from '../../../payments/gates/gateUtil.js';
import {
  fetchAccessToken,
  RecordingHttp,
  type GateRequest,
  type GateResponse,
} from '../../../payments/gates/http.js';
import { retryTransient } from './harness.js';

// A thin driver for the real PayPal sandbox. Every call goes through the recording layer of the
// payments gates, which refuses any host but the sandbox and redacts secrets before a record is
// stored. The session keeps the redacted records so that a spec can write them as its transcript.

export const SANDBOX_BASE_URL = 'https://api-m.sandbox.paypal.com';
const RETURN_URL = 'https://example.com/return';

type Env = Readonly<Record<string, string | undefined>>;

export interface SandboxSession {
  http: RecordingHttp;
  /** Redacted evidence lines, one JSON object each. */
  lines: string[];
  token: string;
  /** Authenticated request with transient answers retried. */
  call(
    step: string,
    req: Omit<GateRequest, 'headers'> & { requestId?: string },
  ): Promise<GateResponse>;
  /** Creates an AUTHORIZE order of `cents`, has the buyer approve it, authorizes it. */
  authorize(label: string, cents: number, buyer?: 'wallet' | 'card'): Promise<Authorized>;
}

export interface Authorized {
  orderId: string;
  authId: string;
  response: GateResponse;
}

export interface SessionOptions {
  env: Env;
  runId: string;
  gate: string;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  launcher?: BrowserLauncher;
}

export async function openSession(opts: SessionOptions): Promise<SandboxSession> {
  const lines: string[] = [];
  const record = (r: EvidenceRecord): void => {
    lines.push(JSON.stringify(r));
  };
  const http = new RecordingHttp({
    baseUrl: SANDBOX_BASE_URL,
    fake: false,
    gate: opts.gate,
    runId: opts.runId,
    scriptVersion: 'qa-sandbox-1',
    record,
    now: opts.now,
  });
  const clientId = opts.env['PAYPAL_CLIENT_ID'] ?? '';
  const clientSecret = opts.env['PAYPAL_CLIENT_SECRET'] ?? '';
  const token = await fetchAccessToken(http, `${opts.gate}.0 token`, clientId, clientSecret);
  let counter = 0;
  const call: SandboxSession['call'] = (step, req) => {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (req.requestId !== undefined) headers['PayPal-Request-Id'] = req.requestId;
    const request: GateRequest = { method: req.method, path: req.path, headers };
    if (req.body !== undefined) request.body = req.body;
    return retryTransient(() => http.request(step, request), { sleep: opts.sleep });
  };
  const authorize: SandboxSession['authorize'] = async (label, cents, buyer = 'wallet') => {
    counter += 1;
    const rid = (part: string): string => `${opts.runId}-${label}-${part}-${counter}`.slice(0, 60);
    const created = await call(`${label} create order`, {
      method: 'POST',
      path: '/v2/checkout/orders',
      requestId: rid('order'),
      body: {
        intent: 'AUTHORIZE',
        purchase_units: [
          {
            reference_id: `${opts.runId}-${label}`,
            custom_id: `${opts.runId}-${label}`,
            amount: amount(cents),
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              return_url: RETURN_URL,
              cancel_url: 'https://example.com/cancel',
              user_action: 'PAY_NOW',
              shipping_preference: 'NO_SHIPPING',
            },
          },
        },
      },
    });
    const orderId = str(field(created.json, 'id'));
    const approveUrl = approveLink(created.json);
    if (created.status >= 300 || orderId === '' || approveUrl === '') {
      throw new Error(`${label}: order creation answered ${created.status}`);
    }
    const credentials = buyerCredentials(opts.env, buyer);
    if (credentials === undefined) throw new Error(`${label}: no ${buyer} buyer credentials`);
    const launcher =
      opts.launcher ??
      (await loadPlaywrightLauncher(opts.env as Record<string, string | undefined>));
    await approveInBrowser({
      approveUrl,
      credentials,
      returnPattern: /example\.com\/return/,
      shotDir: join(tmpdir(), `gavel-sandbox-${opts.runId}`),
      shotPrefix: `${label}-${counter}`,
      launcher,
    });
    http.note(`${label} approve`, 'buyer approval finished', buyer);
    const authorized = await call(`${label} authorize`, {
      method: 'POST',
      path: `/v2/checkout/orders/${orderId}/authorize`,
      requestId: rid('authorize'),
    });
    const authId = str(firstAuthorization(authorized.json)['id']);
    if (authorized.status >= 300 || authId === '') {
      throw new Error(`${label}: authorize answered ${authorized.status}`);
    }
    return { orderId, authId, response: authorized };
  };
  return { http, lines, token, call, authorize };
}
