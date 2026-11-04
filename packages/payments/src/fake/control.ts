import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { FakeApiError } from './core.js';
import { FAULT_KINDS, type FaultKind, type FaultOp, type FaultSpec } from './faults.js';
import type { HandlerResponse } from './faults.js';
import type { FakePayPalServer } from './server.js';
import {
  DEFAULT_FAKE_WEBHOOK_ID,
  type DeliveryOptions,
  type DeliveryOrder,
  type SignedWebhook,
  WebhookEmitter,
} from './webhooks.js';

/**
 * Control surface of the fake PayPal under /__fake/* (SPEC 3.10, R-PAY-121):
 *
 *   POST /__fake/approve/{orderId}     the buyer approves an order
 *   POST /__fake/clock/advance         {ms} | {days} | {hours}
 *   POST /__fake/inject                a FaultSpec; answers {id, pending}
 *   POST /__fake/webhooks/deliver      sign and deliver the event outbox
 *   GET  /__fake/state                 clock, outbox, call audit, faults
 *   GET  /__fake/invariants            the fake's invariant check
 *   POST /__fake/reset                 new core, no faults
 *
 * Test tooling only. Nothing in the production client imports this module, and
 * the real client never calls these paths (the lint test in control.test.ts
 * enforces both). Webhook deliveries are only ever sent to loopback receivers.
 *
 * `FakeControl.handle` is transport free so a server can mount it; until that is
 * done `FakeControlServer` serves the same routes on its own loopback port.
 * NOT the real API.
 */

export const CONTROL_PREFIX = '/__fake/';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MAX_BODY_BYTES = 1_048_576;
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]']);
const FAULT_OPS: ReadonlySet<string> = new Set([
  '*',
  'token',
  'order',
  'get',
  'authorize',
  'capture',
  'void',
  'reauthorize',
  'verify',
]);

type Json = Record<string, unknown>;

export interface FakeControlOptions {
  /** Webhook id the deliveries are signed for. Default WH-FAKE. */
  webhookId?: string;
  /** Waits between delayed deliveries; inject to avoid real waiting in tests. */
  sleep?: (ms: number) => Promise<void>;
}

class BadRequest extends Error {}

function json(status: number, body: unknown): HandlerResponse {
  return { status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

function asObject(v: unknown): Json | undefined {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : undefined;
}

function parseBody(text: string): Json {
  if (text.trim() === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BadRequest('body is not valid JSON');
  }
  const o = asObject(parsed);
  if (o === undefined) throw new BadRequest('body must be a JSON object');
  return o;
}

function optionalNumber(o: Json, key: string): number | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new BadRequest(`${key} must be a number`);
  return v;
}

function faultSpec(o: Json): FaultSpec {
  const kind = o['kind'];
  const op = o['op'];
  if (typeof kind !== 'string' || !(FAULT_KINDS as readonly string[]).includes(kind)) {
    throw new BadRequest(`kind must be one of ${FAULT_KINDS.join(', ')}`);
  }
  if (typeof op !== 'string' || !FAULT_OPS.has(op))
    throw new BadRequest('op is not a known operation');
  const spec: FaultSpec = { kind: kind as FaultKind, op: op as FaultOp | '*' };
  const authId = o['authId'];
  if (authId !== undefined && authId !== null) {
    if (typeof authId !== 'string') throw new BadRequest('authId must be a string or null');
    spec.authId = authId;
  }
  for (const key of ['times', 'afterNthCall', 'ms', 'retryAfterSec', 'timeoutMs'] as const) {
    const n = optionalNumber(o, key);
    if (n !== undefined) spec[key] = n;
  }
  return spec;
}

function deliveryOptions(o: Json): DeliveryOptions {
  const out: DeliveryOptions = {};
  const order = o['order'];
  if (order !== undefined) {
    const shuffle = asObject(order)?.['shuffle'];
    if (order === 'fifo' || order === 'reverse') out.order = order;
    else if (typeof shuffle === 'number' && Number.isFinite(shuffle)) {
      out.order = { shuffle } satisfies DeliveryOrder;
    } else throw new BadRequest('order must be "fifo", "reverse" or {"shuffle": number}');
  }
  if (o['duplicate'] !== undefined) {
    if (typeof o['duplicate'] !== 'boolean') throw new BadRequest('duplicate must be a boolean');
    out.duplicate = o['duplicate'];
  }
  const drop = o['drop'];
  if (drop !== undefined) {
    if (drop === 'all') out.drop = 'all';
    else if (Array.isArray(drop) && drop.every((d) => typeof d === 'string')) {
      out.drop = drop as string[];
    } else throw new BadRequest('drop must be "all" or a list of event ids');
  }
  const delayMs = optionalNumber(o, 'delayMs');
  if (delayMs !== undefined) out.delayMs = delayMs;
  return out;
}

function loopbackTarget(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new BadRequest('target must be a URL string');
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new BadRequest('target is not a URL');
  }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !LOOPBACK_HOSTS.has(u.hostname)) {
    throw new BadRequest('target must be a loopback URL');
  }
  return u.toString();
}

export class FakeControl {
  private readonly webhookId: string;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly emitter: WebhookEmitter;

  constructor(
    private readonly server: FakePayPalServer,
    opts: FakeControlOptions = {},
  ) {
    this.webhookId = opts.webhookId ?? DEFAULT_FAKE_WEBHOOK_ID;
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.emitter = new WebhookEmitter({
      webhookId: this.webhookId,
      nowMs: () => this.server.core.clock.nowMs(),
    });
  }

  /**
   * Serves one control request. Returns undefined when the path is not under
   * /__fake/, so a caller can fall through to its own routes.
   */
  async handle(method: string, path: string, body: string): Promise<HandlerResponse | undefined> {
    if (!path.startsWith(CONTROL_PREFIX)) return undefined;
    const seg = path
      .slice(CONTROL_PREFIX.length)
      .split('/')
      .filter((s) => s !== '');
    const m = method.toUpperCase();
    try {
      const [a, b] = seg;
      if (m === 'POST' && a === 'approve' && b !== undefined && seg.length === 2) {
        return this.approve(decodeURIComponent(b), parseBody(body));
      }
      if (m === 'POST' && a === 'clock' && b === 'advance' && seg.length === 2) {
        return this.advance(parseBody(body));
      }
      if (m === 'POST' && a === 'inject' && seg.length === 1) return this.inject(parseBody(body));
      if (m === 'POST' && a === 'webhooks' && b === 'deliver' && seg.length === 2) {
        return await this.deliver(parseBody(body));
      }
      if (m === 'GET' && a === 'state' && seg.length === 1) return this.state();
      if (m === 'GET' && a === 'invariants' && seg.length === 1) return this.invariants();
      if (m === 'POST' && a === 'reset' && seg.length === 1) return this.reset();
      return json(404, { error: 'not_found', path });
    } catch (e) {
      if (e instanceof BadRequest || e instanceof RangeError) {
        return json(400, { error: 'bad_request', message: e.message });
      }
      if (e instanceof FakeApiError) return json(e.status, { error: e.issue });
      throw e;
    }
  }

  private approve(orderId: string, body: Json): HandlerResponse {
    const payer = body['payer'];
    if (payer !== undefined && (typeof payer !== 'string' || payer === '')) {
      throw new BadRequest('payer must be a non-empty string');
    }
    this.server.core.approveOrder(orderId, payer);
    return json(200, { orderId, status: this.server.core.getOrder(orderId).status });
  }

  private advance(body: Json): HandlerResponse {
    const ms = optionalNumber(body, 'ms');
    const days = optionalNumber(body, 'days');
    const hours = optionalNumber(body, 'hours');
    if (ms === undefined && days === undefined && hours === undefined) {
      throw new BadRequest('give ms, days or hours');
    }
    const total = (ms ?? 0) + (days ?? 0) * DAY_MS + (hours ?? 0) * HOUR_MS;
    if (total < 0) throw new BadRequest('the clock only moves forward');
    const { clock } = this.server.core;
    clock.advance(total);
    return json(200, { nowMs: clock.nowMs(), advancedMs: total });
  }

  private inject(body: Json): HandlerResponse {
    const id = this.server.faults.add(faultSpec(body));
    return json(200, { id, pending: this.server.faults.pending() });
  }

  private async deliver(body: Json): Promise<HandlerResponse> {
    const opts = deliveryOptions(body);
    const target = loopbackTarget(body['target']);
    const from = optionalNumber(body, 'from') ?? 0;
    const events = this.server.core.events.slice(from);
    if (target === undefined) {
      // Hand the signed deliveries back; the caller posts them itself.
      const deliveries = this.emitter.prepare(events, opts).map((d) => ({
        eventId: d.eventId,
        copy: d.copy,
        headers: d.headers,
        rawBody: d.rawBody,
      }));
      return json(200, { webhookId: this.webhookId, deliveries });
    }
    const results: Array<{ eventId: string; status: number }> = [];
    const sink = async (d: SignedWebhook): Promise<void> => {
      let status = 0;
      try {
        const res = await fetch(target, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...d.headers },
          body: d.rawBody,
        });
        status = res.status;
        await res.arrayBuffer();
      } catch {
        status = 0;
      }
      results.push({ eventId: d.eventId, status });
    };
    const delivered = await this.emitter.deliver(events, sink, this.sleep, opts);
    return json(200, { webhookId: this.webhookId, delivered, results });
  }

  private state(): HandlerResponse {
    const { core, faults } = this.server;
    const authIds = new Set<string>();
    for (const e of core.events) {
      const id = e.resource['authId'];
      if (typeof id === 'string') authIds.add(id);
    }
    // Reading through the core would add to its call audit; restore the length after.
    const kept = core.calls.length;
    const authorizations = [...authIds].map((id) => {
      const a = core.getAuthorization(id);
      return {
        id: a.id,
        status: a.status,
        holdCents: a.holdCents,
        capturedCents: a.capturedCents,
        captures: a.captures.map((c) => ({
          id: c.id,
          amountCents: c.amountCents,
          final: c.final,
        })),
      };
    });
    core.calls.length = kept;
    return json(200, {
      nowMs: core.clock.nowMs(),
      events: core.events,
      calls: core.calls,
      authorizations,
      pendingFaults: faults.pending(),
      appliedFaults: faults.applied,
    });
  }

  private invariants(): HandlerResponse {
    try {
      this.server.core.checkInvariants();
      return json(200, { ok: true });
    } catch (e) {
      return json(409, { ok: false, violation: e instanceof Error ? e.message : String(e) });
    }
  }

  private reset(): HandlerResponse {
    this.server.reset();
    return json(200, { ok: true });
  }
}

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

/** Serves FakeControl on its own loopback port. */
export class FakeControlServer {
  private http: Server | undefined;
  private baseUrl: string | undefined;
  readonly control: FakeControl;

  constructor(
    server: FakePayPalServer,
    private readonly opts: FakeControlOptions & { port?: number } = {},
  ) {
    this.control = new FakeControl(server, opts);
  }

  get url(): string {
    if (this.baseUrl === undefined) throw new Error('fake control server is not started');
    return this.baseUrl;
  }

  async start(): Promise<void> {
    if (this.http !== undefined) throw new Error('fake control server is already started');
    const http = createServer((req, res) => {
      void (async () => {
        const body = await readBody(req);
        const path = (req.url ?? '/').split('?')[0] ?? '/';
        const r =
          body === undefined
            ? json(400, { error: 'request_too_large' })
            : ((await this.control.handle(req.method ?? 'GET', path, body)) ??
              json(404, { error: 'not_found', path }));
        res.writeHead(r.status, r.headers ?? {});
        res.end(r.body);
      })().catch(() => {
        res.writeHead(500);
        res.end();
      });
    });
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject);
      http.listen(this.opts.port ?? 0, '127.0.0.1', () => {
        http.off('error', reject);
        resolve();
      });
    });
    this.http = http;
    this.baseUrl = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    const http = this.http;
    if (http === undefined) return;
    this.http = undefined;
    this.baseUrl = undefined;
    await new Promise<void>((resolve) => {
      http.close(() => resolve());
      http.closeAllConnections();
    });
  }
}
