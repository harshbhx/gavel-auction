import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { centsToDecimal, decimalToCents } from '../money.js';
import {
  FakeApiError,
  FakeClock,
  FakePayPalCore,
  FakeTimeout,
  type FakeCoreOptions,
} from './core.js';
import {
  FaultEngine,
  type FaultOp,
  type FaultTimers,
  type HandlerResponse,
  type WireResult,
} from './faults.js';
import { verifyFakeWebhook } from './webhooks.js';

/**
 * FakePayPalServer: HTTP front for FakePayPalCore on a loopback ephemeral port
 * (SPEC 3.10, R-PAY-120). Serves the REST routes the real client calls with
 * PayPal-shaped bodies and a PayPal-Debug-Id header on every response:
 *
 *   POST /v1/oauth2/token
 *   POST /v2/checkout/orders
 *   GET  /v2/checkout/orders/{id}
 *   POST /v2/checkout/orders/{id}/authorize
 *   GET  /v2/payments/authorizations/{id}
 *   POST /v2/payments/authorizations/{id}/capture
 *   POST /v2/payments/authorizations/{id}/void
 *   POST /v2/payments/authorizations/{id}/reauthorize
 *   POST /v1/notifications/verify-webhook-signature
 *
 * Faults go through the FaultEngine (`faults`); the control surface under
 * /__fake/* belongs to PAY-22 and is not served here. Programmatic access to the
 * state machine is `core`; `reset()` starts over with a new core and no faults.
 *
 * The bodies are modelled on PayPal's documented shapes, not recorded from the
 * sandbox. Every assumption is listed in ASSUMPTIONS.md (PAY-24) with the gate
 * that confirms it. NOT the real API.
 */

export interface FakePayPalServerOptions {
  /** Options of the core created at construction and after every reset. */
  core?: FakeCoreOptions;
  /** Timers used by the fault engine; inject to avoid real waiting in tests. */
  timers?: FaultTimers;
  /** Webhook id the verify route checks against. Default WH-FAKE. */
  webhookId?: string;
  /** When set, the token route requires these Basic credentials. */
  clientId?: string;
  clientSecret?: string;
  /** Lifetime of an issued token in seconds. Default 32400, as PayPal's. */
  tokenTtlSec?: number;
  /** Listening port. Default 0 (ephemeral). */
  port?: number;
}

const HOST = '127.0.0.1';
const MAX_BODY_BYTES = 1_048_576;
const DEFAULT_CURRENCY = 'USD';
/** Currencies the fake accepts; the first order of a run fixes the currency of the rest. */
const SUPPORTED_CURRENCIES: readonly string[] = ['USD', 'INR'];
export const DEFAULT_FAKE_WEBHOOK_ID = 'WH-FAKE';
const FAKE_START_MS = Date.UTC(2026, 0, 1);

type Json = Record<string, unknown>;

interface Route {
  op: FaultOp;
  /** Authorization id the fault engine sees, or null. */
  authId: string | null;
  run: (ctx: Ctx) => HandlerResponse;
}

interface Ctx {
  body: string;
  json: Json | undefined;
  requestId: string | undefined;
}

const STATUS_NAMES: Readonly<Record<number, string>> = {
  400: 'INVALID_REQUEST',
  401: 'AUTHENTICATION_FAILURE',
  404: 'RESOURCE_NOT_FOUND',
  422: 'UNPROCESSABLE_ENTITY',
  500: 'INTERNAL_SERVICE_ERROR',
};

function jsonResponse(status: number, body: unknown): HandlerResponse {
  return {
    status,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function errorResponse(status: number, issue: string, message?: string): HandlerResponse {
  return jsonResponse(status, {
    name: STATUS_NAMES[status] ?? `HTTP_${status}`,
    message: message ?? issue,
    details: [{ issue }],
  });
}

function asObject(v: unknown): Json | undefined {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : undefined;
}

function amountOf(cents: number, currency: string): { currency_code: string; value: string } {
  return { currency_code: currency, value: centsToDecimal(cents) };
}

/** Cents from a PayPal amount object; undefined when absent or malformed. */
function centsFromAmount(v: unknown, currency: string): number | undefined {
  const o = asObject(v);
  if (o === undefined || o['currency_code'] !== currency) return undefined;
  const value = o['value'];
  if (typeof value !== 'string') return undefined;
  try {
    const cents = decimalToCents(value);
    return cents > 0 ? cents : undefined;
  } catch {
    return undefined;
  }
}

function realTimers(): FaultTimers {
  return { sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };
}

export class FakePayPalServer {
  private readonly opts: FakePayPalServerOptions;
  private readonly webhookId: string;
  private readonly tokenTtlMs: number;
  private core_: FakePayPalCore;
  private faults_: FaultEngine;
  private readonly timers: FaultTimers;
  private readonly tokens = new Map<string, number>();
  private tokenCount = 0;
  private debugCount = 0;
  private server: Server | undefined;
  private baseUrl: string | undefined;
  private currency = DEFAULT_CURRENCY;

  constructor(opts: FakePayPalServerOptions = {}) {
    this.opts = opts;
    this.webhookId = opts.webhookId ?? DEFAULT_FAKE_WEBHOOK_ID;
    this.tokenTtlMs = (opts.tokenTtlSec ?? 32_400) * 1000;
    this.timers = opts.timers ?? realTimers();
    this.core_ = this.buildCore();
    this.faults_ = this.buildFaults();
  }

  private buildCore(): FakePayPalCore {
    const o = this.opts.core ?? {};
    return new FakePayPalCore({ ...o, clock: o.clock ?? new FakeClock(FAKE_START_MS) });
  }

  private buildFaults(): FaultEngine {
    return new FaultEngine({
      timers: this.timers,
      hooks: { forgetIdempotency: () => this.core_.forgetIdempotency() },
    });
  }

  /** The state machine behind the routes. Replaced by reset(). */
  get core(): FakePayPalCore {
    return this.core_;
  }

  /** The fault engine that wraps every route. Replaced by reset(). */
  get faults(): FaultEngine {
    return this.faults_;
  }

  /** Base URL, for example http://127.0.0.1:41231. Available after start(). */
  get url(): string {
    if (this.baseUrl === undefined) throw new Error('fake PayPal server is not started');
    return this.baseUrl;
  }

  /** Listens on 127.0.0.1. Resolves when the port is bound. */
  async start(): Promise<void> {
    if (this.server !== undefined) throw new Error('fake PayPal server is already started');
    const server = createServer((req, res) => {
      void this.handle(req, res);
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.opts.port ?? 0, HOST, () => {
        server.off('error', reject);
        resolve();
      });
    });
    this.server = server;
    this.baseUrl = `http://${HOST}:${(server.address() as AddressInfo).port}`;
  }

  /** Closes the listener and every open connection. Safe to call twice. */
  async stop(): Promise<void> {
    const server = this.server;
    if (server === undefined) return;
    this.server = undefined;
    this.baseUrl = undefined;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }

  /** New core, no faults, no tokens, counters back to zero. The listener stays up. */
  reset(): void {
    this.currency = DEFAULT_CURRENCY;
    this.core_ = this.buildCore();
    this.faults_ = this.buildFaults();
    this.tokens.clear();
    this.tokenCount = 0;
    this.debugCount = 0;
  }

  // ---------- request handling

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await readBody(req);
      if (body === undefined) {
        this.write(res, errorResponse(400, 'REQUEST_TOO_LARGE'));
        return;
      }
      const wire = await this.dispatch(req, body);
      if (wire.type === 'response') this.write(res, wire);
      else req.socket.destroy();
    } catch {
      this.write(res, errorResponse(500, 'INTERNAL_SERVICE_ERROR'));
    }
  }

  private write(
    res: ServerResponse,
    r: { status: number; headers?: Record<string, string>; body: string },
  ): void {
    this.debugCount += 1;
    const headers = { ...(r.headers ?? {}), 'paypal-debug-id': `fake-debug-${this.debugCount}` };
    res.writeHead(r.status, headers);
    res.end(r.body);
  }

  private async dispatch(req: IncomingMessage, body: string): Promise<WireResult> {
    const method = req.method ?? 'GET';
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    const route = this.route(method, path);
    if (route === undefined) {
      return wireOf(errorResponse(404, 'INVALID_RESOURCE_ID', `no route for ${method} ${path}`));
    }
    const isToken = route.op === 'token';
    const authz = req.headers['authorization'];
    const header = typeof authz === 'string' ? authz : '';

    const handler = (): HandlerResponse => {
      if (isToken) return this.issueToken(header);
      const denied = this.checkBearer(header);
      if (denied !== undefined) return denied;
      const parsed = parseJson(body);
      if (body.trim() !== '' && parsed === undefined && route.op !== 'verify') {
        return errorResponse(400, 'MALFORMED_REQUEST_JSON');
      }
      const reqId = req.headers['paypal-request-id'];
      return this.guarded(() =>
        route.run({
          body,
          json: parsed,
          requestId: typeof reqId === 'string' && reqId !== '' ? reqId : undefined,
        }),
      );
    };

    const before = this.faults_.applied.length;
    let wire: WireResult;
    try {
      wire = await this.faults_.apply({ op: route.op, authId: route.authId }, handler);
    } catch (e) {
      // The core's own timeout fault: the client sees no response.
      if (e instanceof FakeTimeout) return { type: 'timeout' };
      throw e;
    }
    const fired = this.faults_.applied.slice(before);
    // http_401_once: the presented token stops working, so the client must refresh.
    if (fired.some((f) => f.kind === 'http_401_once')) {
      const m = /^Bearer (.+)$/.exec(header);
      if (m?.[1] !== undefined) this.tokens.delete(m[1]);
    }
    return wire;
  }

  /** Turns core failures into the responses PayPal would send. */
  private guarded(fn: () => HandlerResponse): HandlerResponse {
    try {
      return fn();
    } catch (e) {
      if (e instanceof FakeApiError) return errorResponse(e.status, e.issue);
      throw e;
    }
  }

  private issueToken(authHeader: string): HandlerResponse {
    if (this.opts.clientId !== undefined) {
      const expected = Buffer.from(
        `${this.opts.clientId}:${this.opts.clientSecret ?? ''}`,
        'utf8',
      ).toString('base64');
      if (authHeader !== `Basic ${expected}`) {
        return jsonResponse(401, {
          error: 'invalid_client',
          error_description: 'Client Authentication failed',
        });
      }
    }
    this.tokenCount += 1;
    const token = `fake-token-${this.tokenCount}`;
    this.tokens.set(token, this.core_.clock.nowMs() + this.tokenTtlMs);
    return jsonResponse(200, {
      scope: 'https://uri.paypal.com/services/payments/payment/authcapture',
      access_token: token,
      token_type: 'Bearer',
      app_id: 'APP-FAKE',
      expires_in: Math.floor(this.tokenTtlMs / 1000),
      nonce: `fake-nonce-${this.tokenCount}`,
    });
  }

  private checkBearer(authHeader: string): HandlerResponse | undefined {
    const m = /^Bearer (.+)$/.exec(authHeader);
    const expiresAt = m?.[1] === undefined ? undefined : this.tokens.get(m[1]);
    if (expiresAt === undefined || this.core_.clock.nowMs() >= expiresAt) {
      return jsonResponse(401, {
        name: 'AUTHENTICATION_FAILURE',
        message: 'Authentication failed due to invalid authentication credentials',
      });
    }
    return undefined;
  }

  // ---------- routes

  private route(method: string, path: string): Route | undefined {
    const seg = path.split('/').filter((s) => s !== '');
    const [a, b, c, d, e] = seg;
    if (method === 'POST' && path === '/v1/oauth2/token') {
      return { op: 'token', authId: null, run: () => errorResponse(500, 'UNREACHABLE') };
    }
    if (method === 'POST' && path === '/v1/notifications/verify-webhook-signature') {
      return { op: 'verify', authId: null, run: (x) => this.verify(x) };
    }
    if (a === 'v2' && b === 'checkout' && c === 'orders') {
      if (seg.length === 3 && method === 'POST') {
        return { op: 'order', authId: null, run: (x) => this.createOrder(x) };
      }
      if (seg.length === 4 && method === 'GET' && d !== undefined) {
        return { op: 'get', authId: null, run: () => this.getOrder(d) };
      }
      if (seg.length === 5 && method === 'POST' && d !== undefined && e === 'authorize') {
        return { op: 'authorize', authId: null, run: (x) => this.authorize(d, x) };
      }
      return undefined;
    }
    if (a === 'v2' && b === 'payments' && c === 'authorizations' && d !== undefined) {
      if (seg.length === 4 && method === 'GET') {
        return { op: 'get', authId: d, run: () => this.getAuthorization(d) };
      }
      if (seg.length === 5 && method === 'POST') {
        if (e === 'capture') return { op: 'capture', authId: d, run: (x) => this.capture(d, x) };
        if (e === 'void') return { op: 'void', authId: d, run: (x) => this.voidAuth(d, x) };
        if (e === 'reauthorize') {
          return { op: 'reauthorize', authId: d, run: (x) => this.reauthorize(d, x) };
        }
      }
    }
    return undefined;
  }

  private iso(): string {
    return new Date(this.core_.clock.nowMs()).toISOString();
  }

  private createOrder(x: Ctx): HandlerResponse {
    const units = x.json?.['purchase_units'];
    const unit = Array.isArray(units) && units.length === 1 ? asObject(units[0]) : undefined;
    if (x.json === undefined || x.json['intent'] !== 'AUTHORIZE' || unit === undefined) {
      return errorResponse(
        400,
        'INVALID_REQUEST',
        'intent must be AUTHORIZE with one purchase unit',
      );
    }
    const holdId = unit['custom_id'] ?? unit['reference_id'];
    const unitCurrency = asObject(unit['amount'])?.['currency_code'];
    if (typeof unitCurrency === 'string' && SUPPORTED_CURRENCIES.includes(unitCurrency)) {
      this.currency = unitCurrency;
    }
    const cents = centsFromAmount(unit['amount'], this.currency);
    if (typeof holdId !== 'string' || holdId === '' || cents === undefined) {
      return errorResponse(
        400,
        'INVALID_REQUEST',
        'purchase unit needs custom_id and a USD or INR amount',
      );
    }
    const description = typeof unit['description'] === 'string' ? unit['description'] : '';
    const order = this.core_.createOrder({ holdId, amountCents: cents, description }, x.requestId);
    return jsonResponse(201, {
      id: order.id,
      status: order.status,
      intent: 'AUTHORIZE',
      purchase_units: [
        {
          reference_id: holdId,
          custom_id: holdId,
          amount: amountOf(cents, this.currency),
          ...(description === '' ? {} : { description }),
        },
      ],
      create_time: this.iso(),
      links: [
        { href: `${this.url}/v2/checkout/orders/${order.id}`, rel: 'self', method: 'GET' },
        { href: order.approveUrl, rel: 'approve', method: 'GET' },
        {
          href: `${this.url}/v2/checkout/orders/${order.id}/authorize`,
          rel: 'authorize',
          method: 'POST',
        },
      ],
    });
  }

  private getOrder(orderId: string): HandlerResponse {
    const o = this.core_.getOrder(orderId);
    const unit: Json = {
      reference_id: o.holdId,
      custom_id: o.holdId,
      amount: amountOf(o.amountCents, this.currency),
    };
    if (o.authId !== undefined) {
      const a = this.peekAuthorization(o.authId);
      unit['payments'] = {
        authorizations: [
          {
            id: a.id,
            status: a.status,
            amount: amountOf(a.holdCents, this.currency),
            create_time: this.iso(),
          },
        ],
        captures: a.captures.map((c) =>
          captureBody(c.id, c.amountCents, c.final, undefined, this.currency),
        ),
      };
    }
    return jsonResponse(200, {
      id: o.id,
      status: o.status,
      intent: 'AUTHORIZE',
      purchase_units: [unit],
      links: [{ href: `${this.url}/v2/checkout/orders/${o.id}`, rel: 'self', method: 'GET' }],
    });
  }

  private authorize(orderId: string, x: Ctx): HandlerResponse {
    const a = this.core_.authorizeOrder(orderId, x.requestId);
    return jsonResponse(201, {
      id: orderId,
      status: 'COMPLETED',
      intent: 'AUTHORIZE',
      purchase_units: [
        {
          amount: amountOf(a.amountCents, this.currency),
          payments: {
            authorizations: [
              {
                id: a.authId,
                status: a.status,
                amount: amountOf(a.amountCents, this.currency),
                create_time: this.iso(),
              },
            ],
          },
        },
      ],
    });
  }

  private getAuthorization(authId: string): HandlerResponse {
    const a = this.core_.getAuthorization(authId);
    return jsonResponse(200, {
      id: a.id,
      status: a.status,
      amount: amountOf(a.holdCents, this.currency),
      create_time: this.iso(),
      links: [
        {
          href: `${this.url}/v2/payments/authorizations/${a.id}`,
          rel: 'self',
          method: 'GET',
        },
      ],
    });
  }

  private capture(authId: string, x: Ctx): HandlerResponse {
    const json = x.json ?? {};
    const cents =
      json['amount'] === undefined
        ? this.remainder(authId)
        : (centsFromAmount(json['amount'], this.currency) ?? 0);
    const invoice = typeof json['invoice_id'] === 'string' ? json['invoice_id'] : undefined;
    const final = json['final_capture'] === true;
    const c = this.core_.capture(authId, cents, final, x.requestId);
    return jsonResponse(
      201,
      captureBody(c.id, c.amountCents, c.finalCapture, invoice, this.currency),
    );
  }

  /** Amount left on the authorization, for a capture request without an amount. */
  private remainder(authId: string): number {
    const a = this.peekAuthorization(authId);
    return Math.max(0, a.holdCents - a.capturedCents);
  }

  /** Reads an authorization without adding an entry to the core's call audit. */
  private peekAuthorization(authId: string): ReturnType<FakePayPalCore['getAuthorization']> {
    const kept = this.core_.calls.length;
    try {
      return this.core_.getAuthorization(authId);
    } finally {
      this.core_.calls.length = kept;
    }
  }

  private voidAuth(authId: string, x: Ctx): HandlerResponse {
    this.core_.void(authId, x.requestId);
    return { status: 204, headers: {}, body: '' };
  }

  private reauthorize(authId: string, x: Ctx): HandlerResponse {
    const cents = centsFromAmount(x.json?.['amount'], this.currency) ?? 0;
    const r = this.core_.reauthorize(authId, cents, x.requestId);
    return jsonResponse(201, {
      id: r.id,
      status: r.status,
      amount: amountOf(r.amountCents, this.currency),
      create_time: this.iso(),
    });
  }

  private verify(x: Ctx): HandlerResponse {
    return jsonResponse(200, verifyFakeWebhook(x.body, this.webhookId));
  }
}

function captureBody(
  id: string,
  cents: number,
  final: boolean,
  invoice: string | undefined,
  currency: string,
): Json {
  return {
    id,
    status: 'COMPLETED',
    amount: amountOf(cents, currency),
    final_capture: final,
    ...(invoice === undefined ? {} : { invoice_id: invoice }),
  };
}

function wireOf(r: HandlerResponse): WireResult {
  return { type: 'response', status: r.status, headers: { ...(r.headers ?? {}) }, body: r.body };
}

function parseJson(text: string): Json | undefined {
  if (text.trim() === '') return undefined;
  try {
    return asObject(JSON.parse(text));
  } catch {
    return undefined;
  }
}

/** Whole request body as text; undefined when it exceeds the size cap. */
async function readBody(req: IncomingMessage): Promise<string | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) return undefined;
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}
