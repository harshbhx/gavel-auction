import type { Clock } from '../ports.js';

/**
 * In-memory fake of the PayPal authorize/capture/void/reauthorize slice plus
 * orders (R-PAY-120, R-PAY-124, R-PAY-125). Port of reference/python/fake_paypal.py.
 * Amounts are integer cents, time is milliseconds from an injected clock, ids are
 * sequential per kind (AUTH-1, CAP-1, ORDER-1, WH-1). NOT the real API.
 *
 * Every behaviour that the prototype marks [assumed] is an assumption of this fake
 * (see ASSUMPTIONS.md, PAY-24); the gate that confirms it is named at the spot.
 */

export const DAY_MS = 86_400_000;

/** Manually advanced clock for tests and the fake server. */
export class FakeClock implements Clock {
  private t: number;
  constructor(startMs = 0) {
    this.t = startMs;
  }
  nowMs(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
  set(ms: number): void {
    this.t = ms;
  }
}

/** An error response from the fake: HTTP status plus PayPal-style error name. */
export class FakeApiError extends Error {
  status: number;
  /** PayPal-style issue/error name, e.g. AUTHORIZATION_VOIDED. */
  issue: string;
  constructor(status: number, issue: string) {
    super(`${status} ${issue}`);
    this.name = 'FakeApiError';
    this.status = status;
    this.issue = issue;
  }
}

/** The client saw no response; the call may or may not have been applied. */
export class FakeTimeout extends Error {
  op: string;
  constructor(op: string) {
    super(`timeout: ${op}`);
    this.name = 'FakeTimeout';
    this.op = op;
  }
}

export type FakeFaultKind =
  'timeout_before' | 'timeout_after_success' | 'http_500' | 'capture_declined';

export type FakeOp = 'order' | 'authorize' | 'capture' | 'void' | 'reauthorize' | 'get';

export type AuthStatus = 'CREATED' | 'PARTIALLY_CAPTURED' | 'CAPTURED' | 'VOIDED' | 'EXPIRED';
export type OrderStatus = 'CREATED' | 'APPROVED' | 'COMPLETED';

export interface FakeCaptureRecord {
  id: string;
  amountCents: number;
  final: boolean;
  requestId: string | undefined;
}

interface AuthRecord {
  id: string;
  payer: string;
  holdCents: number;
  startMs: number;
  status: AuthStatus;
  captures: FakeCaptureRecord[];
  voidEffects: number;
  reauths: number;
  /** autoReleaseRemainder=false only: the remainder was explicitly voided. */
  remainderVoided: boolean;
}

interface OrderRecord {
  id: string;
  holdId: string;
  amountCents: number;
  description: string;
  status: OrderStatus;
  payer: string | undefined;
  authId: string | undefined;
}

export interface FakeCoreOptions {
  clock?: FakeClock;
  /** Seeds delivery shuffles; same seed and call sequence give identical results. */
  seed?: number;
  /** Default 3 days. */
  honorMs?: number;
  /** Default 29 days. */
  validityMs?: number;
  /** Capture after the honor period: "ok" (default) or "fail". Assumption, gate G3. */
  afterHonorCapture?: 'ok' | 'fail';
  /**
   * After a final capture the unused remainder is released by PayPal (default
   * true). When false the remainder stays held until an explicit void.
   * Assumption, gate G1.
   */
  autoReleaseRemainder?: boolean;
  /** Maximum total captured for a hold of holdCents. Default min(115%, +$75). Assumption, gate G1. */
  captureLimit?: (holdCents: number) => number;
  /** Base of generated approve links. Default http://127.0.0.1/checkoutnow. */
  approveBaseUrl?: string;
}

export interface FakeWebhookEvent {
  id: string;
  eventType: string;
  resource: Record<string, string | number>;
}

export type DeliveryMode = 'fifo' | 'reverse' | 'shuffle';

export interface FakeAuthView {
  id: string;
  status: AuthStatus;
  holdCents: number;
  capturedCents: number;
  captureRequestIds: Array<string | undefined>;
  captures: FakeCaptureRecord[];
}

interface Fault {
  op: FakeOp;
  kind: FakeFaultKind;
  targetId: string | null;
  times: number;
}

/** Default over-capture cap: hold + min(15% of hold, $75). */
export function defaultCaptureLimit(holdCents: number): number {
  return holdCents + Math.min(Math.floor((holdCents * 15) / 100), 7500);
}

/** mulberry32: small seeded PRNG, stable across platforms. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  const rand = prng(seed);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return out;
}

export class FakePayPalCore {
  readonly clock: FakeClock;
  readonly honorMs: number;
  readonly validityMs: number;
  readonly afterHonorCapture: 'ok' | 'fail';
  readonly autoReleaseRemainder: boolean;
  readonly seed: number;
  /** Webhook outbox in emission order. */
  readonly events: FakeWebhookEvent[] = [];
  /** Audit of API calls that reached the server: (op, target id). */
  readonly calls: Array<{ op: FakeOp; id: string }> = [];

  private readonly limit: (holdCents: number) => number;
  private readonly approveBaseUrl: string;
  private readonly auths = new Map<string, AuthRecord>();
  private readonly orders = new Map<string, OrderRecord>();
  private readonly idem = new Map<string, { params: string; result: unknown }>();
  private readonly counters = new Map<string, number>();
  private faults: Fault[] = [];

  constructor(opts: FakeCoreOptions = {}) {
    this.clock = opts.clock ?? new FakeClock();
    this.seed = opts.seed ?? 0;
    this.honorMs = opts.honorMs ?? 3 * DAY_MS;
    this.validityMs = opts.validityMs ?? 29 * DAY_MS;
    this.afterHonorCapture = opts.afterHonorCapture ?? 'ok';
    this.autoReleaseRemainder = opts.autoReleaseRemainder ?? true;
    this.limit = opts.captureLimit ?? defaultCaptureLimit;
    this.approveBaseUrl = opts.approveBaseUrl ?? 'http://127.0.0.1/checkoutnow';
  }

  // ---------- fault injection (minimal; the full engine is PAY-20)

  /** Arms a fault for the next `times` matching calls. targetId null matches any. */
  inject(op: FakeOp, kind: FakeFaultKind, targetId: string | null = null, times = 1): void {
    this.faults.push({ op, kind, targetId, times });
  }

  /** Clears the idempotency table (simulates retention expiry). */
  forgetIdempotency(): void {
    this.idem.clear();
  }

  // ---------- internals

  private nextId(prefix: string): string {
    const n = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, n);
    return `${prefix}-${n}`;
  }

  private emit(eventType: string, resource: Record<string, string | number>): void {
    this.events.push({ id: this.nextId('WH'), eventType, resource });
  }

  private takeFault(op: FakeOp, id: string): FakeFaultKind | null {
    for (const f of this.faults) {
      if (f.op === op && (f.targetId === null || f.targetId === id) && f.times > 0) {
        f.times -= 1;
        return f.kind;
      }
    }
    return null;
  }

  private static hasFinal(a: AuthRecord): boolean {
    return a.captures.some((c) => c.final);
  }

  private static capturedOf(a: AuthRecord): number {
    return a.captures.reduce((sum, c) => sum + c.amountCents, 0);
  }

  private refresh(a: AuthRecord): void {
    if (a.status !== 'CREATED' && a.status !== 'PARTIALLY_CAPTURED') return;
    if (this.clock.nowMs() - a.startMs <= this.validityMs) return;
    if (a.status === 'CREATED' || !FakePayPalCore.hasFinal(a)) {
      a.status = 'EXPIRED';
      this.emit('PAYMENT.AUTHORIZATION.VOIDED', { authId: a.id, reason: 'expired' });
    }
  }

  private auth(authId: string): AuthRecord {
    const a = this.auths.get(authId);
    if (a === undefined) throw new FakeApiError(404, 'RESOURCE_NOT_FOUND');
    this.refresh(a);
    return a;
  }

  /**
   * One API call: audit, fault, idempotency replay, apply. Same (op, id,
   * requestId) with equal params replays the stored result; different params give
   * 422 DUPLICATE_REQUEST_ID_DIFFERENT_PARAMS (name assumed, gate G1).
   */
  private run<T>(
    op: FakeOp,
    id: string,
    requestId: string | undefined,
    params: string,
    fn: () => T,
  ): T {
    this.calls.push({ op, id });
    const fault = this.takeFault(op, id);
    if (fault === 'timeout_before') throw new FakeTimeout(op);
    if (fault === 'http_500') throw new FakeApiError(500, 'INTERNAL_SERVICE_ERROR');
    const key = requestId === undefined ? null : `${op}|${id}|${requestId}`;
    if (key !== null) {
      const stored = this.idem.get(key);
      if (stored !== undefined) {
        if (stored.params !== params) {
          throw new FakeApiError(422, 'DUPLICATE_REQUEST_ID_DIFFERENT_PARAMS');
        }
        if (fault === 'timeout_after_success') throw new FakeTimeout(op);
        return structuredClone(stored.result) as T;
      }
    }
    if (fault === 'capture_declined') throw new FakeApiError(422, 'INSTRUMENT_DECLINED');
    const result = fn();
    if (key !== null) this.idem.set(key, { params, result: structuredClone(result) });
    if (fault === 'timeout_after_success') throw new FakeTimeout(op);
    return result;
  }

  // ---------- orders

  createOrder(
    i: { holdId: string; amountCents: number; description?: string },
    requestId?: string,
  ): { id: string; status: OrderStatus; approveUrl: string } {
    return this.run('order', i.holdId, requestId, JSON.stringify([i.holdId, i.amountCents]), () => {
      if (!Number.isSafeInteger(i.amountCents) || i.amountCents <= 0) {
        throw new FakeApiError(400, 'INVALID_AMOUNT');
      }
      const id = this.nextId('ORDER');
      this.orders.set(id, {
        id,
        holdId: i.holdId,
        amountCents: i.amountCents,
        description: i.description ?? '',
        status: 'CREATED',
        payer: undefined,
        authId: undefined,
      });
      return { id, status: 'CREATED' as const, approveUrl: `${this.approveBaseUrl}?token=${id}` };
    });
  }

  /** Simulates the buyer approving the order in the PayPal UI. Not an API call. */
  approveOrder(orderId: string, payer = 'buyer'): void {
    const o = this.orders.get(orderId);
    if (o === undefined) throw new FakeApiError(404, 'RESOURCE_NOT_FOUND');
    if (o.status === 'CREATED') {
      o.status = 'APPROVED';
      o.payer = payer;
      this.emit('CHECKOUT.ORDER.APPROVED', { orderId });
    }
  }

  getOrder(orderId: string): {
    id: string;
    status: OrderStatus;
    holdId: string;
    amountCents: number;
    authId?: string;
  } {
    this.calls.push({ op: 'get', id: orderId });
    const o = this.orders.get(orderId);
    if (o === undefined) throw new FakeApiError(404, 'RESOURCE_NOT_FOUND');
    const view = { id: o.id, status: o.status, holdId: o.holdId, amountCents: o.amountCents };
    return o.authId === undefined ? view : { ...view, authId: o.authId };
  }

  authorizeOrder(
    orderId: string,
    requestId?: string,
  ): { authId: string; amountCents: number; status: AuthStatus } {
    return this.run('authorize', orderId, requestId, '[]', () => {
      const o = this.orders.get(orderId);
      if (o === undefined) throw new FakeApiError(404, 'RESOURCE_NOT_FOUND');
      if (o.status === 'COMPLETED') throw new FakeApiError(422, 'ORDER_ALREADY_AUTHORIZED');
      if (o.status !== 'APPROVED') throw new FakeApiError(422, 'ORDER_NOT_APPROVED');
      const created = this.createAuthorization(o.payer ?? 'buyer', o.amountCents);
      o.status = 'COMPLETED';
      o.authId = created.id;
      this.emit('PAYMENT.AUTHORIZATION.CREATED', { authId: created.id, orderId });
      return { authId: created.id, amountCents: o.amountCents, status: created.status };
    });
  }

  // ---------- authorizations

  /** Creates an authorization directly (test setup; not an API call). */
  createAuthorization(
    payer: string,
    amountCents: number,
  ): { id: string; status: AuthStatus; amountCents: number } {
    const a: AuthRecord = {
      id: this.nextId('AUTH'),
      payer,
      holdCents: amountCents,
      startMs: this.clock.nowMs(),
      status: 'CREATED',
      captures: [],
      voidEffects: 0,
      reauths: 0,
      remainderVoided: false,
    };
    this.auths.set(a.id, a);
    return { id: a.id, status: 'CREATED', amountCents };
  }

  authCount(): number {
    return this.auths.size;
  }

  getAuthorization(authId: string): FakeAuthView {
    this.calls.push({ op: 'get', id: authId });
    const a = this.auth(authId);
    return {
      id: a.id,
      status: a.status,
      holdCents: a.holdCents,
      capturedCents: FakePayPalCore.capturedOf(a),
      captureRequestIds: a.captures.map((c) => c.requestId),
      captures: a.captures.map((c) => ({ ...c })),
    };
  }

  capture(
    authId: string,
    amountCents: number,
    finalCapture = true,
    requestId?: string,
  ): { id: string; status: 'COMPLETED'; amountCents: number; finalCapture: boolean } {
    return this.run(
      'capture',
      authId,
      requestId,
      JSON.stringify([amountCents, finalCapture]),
      () => {
        const a = this.auth(authId);
        if (a.status === 'VOIDED') throw new FakeApiError(422, 'AUTHORIZATION_VOIDED');
        if (a.status === 'EXPIRED') throw new FakeApiError(422, 'AUTHORIZATION_EXPIRED'); // [assumed name], G1
        if (a.status === 'CAPTURED' || FakePayPalCore.hasFinal(a)) {
          throw new FakeApiError(422, 'AUTHORIZATION_ALREADY_CAPTURED');
        }
        if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
          throw new FakeApiError(400, 'INVALID_AMOUNT');
        }
        if (FakePayPalCore.capturedOf(a) + amountCents > this.limit(a.holdCents)) {
          throw new FakeApiError(422, 'CAPTURE_AMOUNT_EXCEEDS_LIMIT');
        }
        if (this.clock.nowMs() - a.startMs > this.honorMs && this.afterHonorCapture === 'fail') {
          throw new FakeApiError(422, 'AUTHORIZATION_NOT_HONORED_AFTER_HONOR_PERIOD');
        }
        const id = this.nextId('CAP');
        a.captures.push({ id, amountCents, final: finalCapture, requestId });
        a.status = finalCapture ? 'CAPTURED' : 'PARTIALLY_CAPTURED';
        this.emit('PAYMENT.CAPTURE.COMPLETED', { authId: a.id, captureId: id, amountCents });
        return { id, status: 'COMPLETED' as const, amountCents, finalCapture };
      },
    );
  }

  void(authId: string, requestId?: string): { id: string; status: AuthStatus } {
    return this.run('void', authId, requestId, '[]', () => {
      const a = this.auth(authId);
      if (a.status === 'VOIDED') throw new FakeApiError(422, 'AUTHORIZATION_ALREADY_VOIDED'); // [assumed name], G1
      if (a.status === 'EXPIRED') throw new FakeApiError(422, 'AUTHORIZATION_EXPIRED');
      const finalDone = a.status === 'CAPTURED' || FakePayPalCore.hasFinal(a);
      if (finalDone) {
        // Without auto-release the remainder is voided explicitly (assumption, G1).
        const remainder = a.holdCents - FakePayPalCore.capturedOf(a);
        if (this.autoReleaseRemainder || a.remainderVoided || remainder <= 0) {
          throw new FakeApiError(422, 'AUTHORIZATION_ALREADY_CAPTURED');
        }
        a.remainderVoided = true;
        a.voidEffects += 1;
        this.emit('PAYMENT.AUTHORIZATION.VOIDED', { authId: a.id, reason: 'void' });
        return { id: a.id, status: a.status };
      }
      a.status = 'VOIDED';
      a.voidEffects += 1;
      this.emit('PAYMENT.AUTHORIZATION.VOIDED', { authId: a.id, reason: 'void' });
      return { id: a.id, status: a.status };
    });
  }

  reauthorize(
    authId: string,
    amountCents: number,
    requestId?: string,
  ): { id: string; status: AuthStatus; amountCents: number } {
    return this.run('reauthorize', authId, requestId, JSON.stringify([amountCents]), () => {
      const a = this.auth(authId);
      if (a.status !== 'CREATED' && a.status !== 'PARTIALLY_CAPTURED') {
        throw new FakeApiError(422, 'REAUTHORIZATION_NOT_ALLOWED');
      }
      if (this.clock.nowMs() - a.startMs <= this.honorMs) {
        throw new FakeApiError(422, 'REAUTHORIZATION_TOO_EARLY');
      }
      if (amountCents > this.limit(a.holdCents)) {
        throw new FakeApiError(422, 'REAUTHORIZATION_AMOUNT_EXCEEDS_LIMIT');
      }
      a.holdCents = amountCents;
      a.startMs = this.clock.nowMs();
      a.reauths += 1;
      return { id: a.id, status: a.status, amountCents };
    });
  }

  // ---------- housekeeping

  /** Applies lazy expiry to every authorization. */
  sweep(): void {
    for (const a of this.auths.values()) this.refresh(a);
  }

  /**
   * The outbox as a receiver would see it. fifo | reverse | shuffle (seeded), and
   * optionally duplicated (every event twice).
   */
  deliver(
    mode: DeliveryMode = 'fifo',
    opts: { duplicate?: boolean; seed?: number } = {},
  ): FakeWebhookEvent[] {
    const seed = opts.seed ?? this.seed;
    let ev = [...this.events];
    if (mode === 'reverse') ev.reverse();
    else if (mode === 'shuffle') ev = shuffled(ev, seed);
    if (opts.duplicate === true) {
      ev = [...ev, ...this.events];
      if (mode === 'shuffle') ev = shuffled(ev, seed + 1);
    }
    return ev;
  }

  // ---------- invariants

  /** Ported from check_invariants; throws Error on the first violation. */
  checkInvariants(): true {
    for (const a of this.auths.values()) {
      this.refresh(a);
      const captured = FakePayPalCore.capturedOf(a);
      const fail = (msg: string): never => {
        throw new Error(`${a.id} ${msg}`);
      };
      if (captured > this.limit(a.holdCents)) fail('captured above cap');
      if (a.captures.filter((c) => c.final).length > 1) fail('has more than one final capture');
      const last = a.captures[a.captures.length - 1];
      if (FakePayPalCore.hasFinal(a) && last !== undefined && !last.final)
        fail('capture after final');
      if (a.voidEffects > 1) fail('voided twice');
      if (a.voidEffects > 0 && a.captures.length > 0 && !a.remainderVoided)
        fail('voided and captured');
      if (a.status === 'VOIDED' && a.voidEffects !== 1)
        fail('voided without exactly one void effect');
    }
    return true;
  }

  /**
   * Funds returned to the payer from this hold: the whole hold if voided or
   * expired, the remainder after a final capture (automatic, or after an explicit
   * void when autoReleaseRemainder is false), else 0 while still held.
   */
  released(authId: string): number {
    const a = this.auths.get(authId);
    if (a === undefined) throw new FakeApiError(404, 'RESOURCE_NOT_FOUND');
    this.refresh(a);
    if (a.status === 'VOIDED' || a.status === 'EXPIRED') return a.holdCents;
    if (FakePayPalCore.hasFinal(a)) {
      const remainder = Math.max(0, a.holdCents - FakePayPalCore.capturedOf(a));
      return this.autoReleaseRemainder || a.remainderVoided ? remainder : 0;
    }
    return 0;
  }

  /** Test access to internal counters of one authorization. */
  inspect(authId: string): { voidEffects: number; reauths: number; capturedCents: number } {
    const a = this.auths.get(authId);
    if (a === undefined) throw new FakeApiError(404, 'RESOURCE_NOT_FOUND');
    return {
      voidEffects: a.voidEffects,
      reauths: a.reauths,
      capturedCents: FakePayPalCore.capturedOf(a),
    };
  }
}
