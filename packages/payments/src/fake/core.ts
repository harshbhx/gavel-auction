import type { Clock } from '../ports.js';
import { IdempotencyConflict, IdempotencyTable } from './idempotency.js';

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
  | 'timeout_before'
  | 'timeout_after_success'
  | 'http_500'
  | 'http_429'
  | 'connection_reset'
  | 'forget_idempotency'
  | 'capture_declined'
  /** The capture is accepted as PENDING; completeCapture or denyCapture settles it later. */
  | 'capture_pending';

export type FakeOp = 'order' | 'authorize' | 'capture' | 'void' | 'reauthorize' | 'get';

export type AuthStatus = 'CREATED' | 'PARTIALLY_CAPTURED' | 'CAPTURED' | 'VOIDED' | 'EXPIRED';
export type OrderStatus = 'CREATED' | 'APPROVED' | 'COMPLETED';
/** PENDING until PayPal completes or declines it (R11-O03); a DECLINED capture took nothing. */
export type FakeCaptureStatus = 'COMPLETED' | 'PENDING' | 'DECLINED';

export interface FakeCaptureRecord {
  id: string;
  amountCents: number;
  final: boolean;
  requestId: string | undefined;
  /** The invoice_id the capture request carried; PayPal echoes it on the capture. */
  invoiceId?: string;
  status: FakeCaptureStatus;
}

interface AuthRecord {
  id: string;
  payer: string;
  holdCents: number;
  /** The amount the buyer authorized; never raised by a reauthorization (R-PAY-061, R-PAY-071). */
  ceilingCents: number;
  startMs: number;
  status: AuthStatus;
  captures: FakeCaptureRecord[];
  voidEffects: number;
  reauths: number;
  /** autoReleaseRemainder=false only: the remainder was explicitly voided. */
  remainderVoided: boolean;
  /** A reauthorization moved the funds to this new authorization (R11-O06). */
  reauthorizedTo?: string;
  /** The authorization this one replaced through a reauthorization. */
  reauthorizedFrom?: string;
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
  private readonly idem = new IdempotencyTable();
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
    if ((kind === 'capture_declined' || kind === 'capture_pending') && op !== 'capture') {
      throw new Error(`fault ${kind} only applies to capture, not ${op}`);
    }
    if (kind === 'forget_idempotency' && op === 'get') {
      throw new Error(`fault ${kind} does not apply to reads`);
    }
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

  /** Faults that stop a call before it has any effect. Shared by writes and reads. */
  private failBeforeApply(op: FakeOp, fault: FakeFaultKind | null): void {
    if (fault === 'timeout_before' || fault === 'connection_reset') throw new FakeTimeout(op);
    if (fault === 'http_500') throw new FakeApiError(500, 'INTERNAL_SERVICE_ERROR');
    if (fault === 'http_429') throw new FakeApiError(429, 'RATE_LIMIT_REACHED');
  }

  /** A read (GET) is faulted like any call; a read has no effect to time out after. */
  private readFault(id: string): void {
    const fault = this.takeFault('get', id);
    this.failBeforeApply('get', fault);
    if (fault === 'timeout_after_success') throw new FakeTimeout('get');
  }

  /** Captures that took money or may still take it; a declined capture took nothing. */
  private static live(a: AuthRecord): FakeCaptureRecord[] {
    return a.captures.filter((c) => c.status !== 'DECLINED');
  }

  private static hasFinal(a: AuthRecord): boolean {
    return FakePayPalCore.live(a).some((c) => c.final);
  }

  private static capturedOf(a: AuthRecord): number {
    return FakePayPalCore.live(a).reduce((sum, c) => sum + c.amountCents, 0);
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
    fn: (fault: FakeFaultKind | null) => T,
  ): T {
    this.calls.push({ op, id });
    const fault = this.takeFault(op, id);
    this.failBeforeApply(op, fault);
    // forget_idempotency: the server has lost its table, so the retry executes again.
    const key =
      requestId === undefined || fault === 'forget_idempotency' ? null : `${op}|${id}|${requestId}`;
    if (key !== null) {
      let stored: T | undefined;
      try {
        stored = this.idem.replay<T>(key, params);
      } catch (e) {
        if (e instanceof IdempotencyConflict) {
          throw new FakeApiError(422, 'DUPLICATE_REQUEST_ID_DIFFERENT_PARAMS');
        }
        throw e;
      }
      if (stored !== undefined) {
        if (fault === 'timeout_after_success') throw new FakeTimeout(op);
        return stored;
      }
    }
    if (fault === 'capture_declined') throw new FakeApiError(422, 'INSTRUMENT_DECLINED');
    const result = fn(fault);
    if (key !== null) this.idem.store(key, params, result);
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
    this.readFault(orderId);
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
      ceilingCents: amountCents,
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
    this.readFault(authId);
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
    invoiceId?: string,
  ): {
    id: string;
    status: 'COMPLETED' | 'PENDING';
    amountCents: number;
    finalCapture: boolean;
  } {
    return this.run(
      'capture',
      authId,
      requestId,
      JSON.stringify([amountCents, finalCapture]),
      (fault) => {
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
        // R11-O03: a pending capture holds the money for the capture until PayPal decides.
        const status = fault === 'capture_pending' ? ('PENDING' as const) : ('COMPLETED' as const);
        a.captures.push({
          id,
          amountCents,
          final: finalCapture,
          requestId,
          ...(invoiceId === undefined ? {} : { invoiceId }),
          status,
        });
        a.status = finalCapture ? 'CAPTURED' : 'PARTIALLY_CAPTURED';
        this.emit(`PAYMENT.CAPTURE.${status}`, { authId: a.id, captureId: id, amountCents });
        return { id, status, amountCents, finalCapture };
      },
    );
  }

  private pendingCapture(captureId: string): { a: AuthRecord; c: FakeCaptureRecord } {
    for (const a of this.auths.values()) {
      const c = a.captures.find((x) => x.id === captureId);
      if (c === undefined) continue;
      if (c.status !== 'PENDING') throw new FakeApiError(422, 'CAPTURE_NOT_PENDING');
      return { a, c };
    }
    throw new FakeApiError(404, 'RESOURCE_NOT_FOUND');
  }

  /** Simulates PayPal completing a pending capture (R11-O03). Not an API call. */
  completeCapture(captureId: string): void {
    const { a, c } = this.pendingCapture(captureId);
    c.status = 'COMPLETED';
    this.emit('PAYMENT.CAPTURE.COMPLETED', {
      authId: a.id,
      captureId: c.id,
      amountCents: c.amountCents,
    });
  }

  /**
   * Simulates PayPal declining a pending capture (R11-O03): no money moves and the
   * authorization is open again, as if the capture had never been made. Not an API call.
   */
  denyCapture(captureId: string): void {
    const { a, c } = this.pendingCapture(captureId);
    c.status = 'DECLINED';
    const live = FakePayPalCore.live(a);
    if (a.status === 'CAPTURED' || a.status === 'PARTIALLY_CAPTURED') {
      a.status =
        live.length === 0
          ? 'CREATED'
          : FakePayPalCore.hasFinal(a)
            ? 'CAPTURED'
            : 'PARTIALLY_CAPTURED';
    }
    this.emit('PAYMENT.CAPTURE.DENIED', {
      authId: a.id,
      captureId: c.id,
      amountCents: c.amountCents,
    });
  }

  /**
   * Every authorization of a reauthorization chain, the first one first (R11-O06): the
   * authorizations the order lists. Not an API call.
   */
  reauthorizationChain(authId: string): string[] {
    let root = this.auths.get(authId);
    if (root === undefined) return [];
    while (root.reauthorizedFrom !== undefined) {
      const prev = this.auths.get(root.reauthorizedFrom);
      if (prev === undefined) break;
      root = prev;
    }
    const chain: string[] = [];
    for (let a: AuthRecord | undefined = root; a !== undefined; ) {
      chain.push(a.id);
      a = a.reauthorizedTo === undefined ? undefined : this.auths.get(a.reauthorizedTo);
    }
    return chain;
  }

  /** Every capture record the order of this authorization lists, declined ones too. Not an API call. */
  orderCaptures(authId: string): FakeCaptureRecord[] {
    return this.reauthorizationChain(authId).flatMap((id) =>
      (this.auths.get(id)?.captures ?? []).map((c) => ({ ...c })),
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
          // The verified issue name of a void after a final capture (G1, sandbox).
          throw new FakeApiError(422, 'PREVIOUSLY_CAPTURED');
        }
        a.remainderVoided = true;
        a.voidEffects += 1;
        this.emit('PAYMENT.AUTHORIZATION.VOIDED', { authId: a.id, reason: 'void' });
        return { id: a.id, status: a.status };
      }
      a.status = 'VOIDED';
      a.voidEffects += 1;
      // Voiding a partially captured authorization releases the open remainder (assumed, G1).
      if (FakePayPalCore.live(a).length > 0) a.remainderVoided = true;
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
      if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
        throw new FakeApiError(400, 'INVALID_AMOUNT');
      }
      if (amountCents < FakePayPalCore.capturedOf(a)) {
        throw new FakeApiError(422, 'REAUTHORIZATION_BELOW_CAPTURED');
      }
      if (amountCents > a.ceilingCents || amountCents > this.limit(a.holdCents)) {
        throw new FakeApiError(422, 'REAUTHORIZATION_AMOUNT_EXCEEDS_LIMIT');
      }
      // R11-O06 (A11): PayPal answers with a new authorization that has its own id and a new
      // honor period; the funds are held under it from now on. The old id is closed: it
      // reads VOIDED and refuses capture and void (assumed, gate G3).
      const next: AuthRecord = {
        id: this.nextId('AUTH'),
        payer: a.payer,
        holdCents: amountCents,
        ceilingCents: a.ceilingCents,
        startMs: this.clock.nowMs(),
        status: 'CREATED',
        captures: [],
        voidEffects: 0,
        reauths: a.reauths + 1,
        remainderVoided: false,
        reauthorizedFrom: a.id,
      };
      this.auths.set(next.id, next);
      a.reauths += 1;
      a.reauthorizedTo = next.id;
      a.status = 'VOIDED';
      return { id: next.id, status: next.status, amountCents };
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

  /**
   * Ported from check_invariants; throws Error on the first violation. The total
   * captured never exceeds the buyer's ceiling (R-PAY-061), independently of the
   * over-capture limit the fake tolerates; pass allowOverCapture only in tests
   * of that limit itself.
   */
  checkInvariants(opts: { allowOverCapture?: boolean } = {}): true {
    for (const a of this.auths.values()) {
      this.refresh(a);
      const captured = FakePayPalCore.capturedOf(a);
      const fail = (msg: string): never => {
        throw new Error(`${a.id} ${msg}`);
      };
      if (captured > this.limit(a.holdCents)) fail('captured above cap');
      if (opts.allowOverCapture !== true && captured > a.ceilingCents) {
        fail('captured above the authorized ceiling');
      }
      const live = FakePayPalCore.live(a);
      if (live.filter((c) => c.final).length > 1) fail('has more than one final capture');
      const last = live[live.length - 1];
      if (FakePayPalCore.hasFinal(a) && last !== undefined && !last.final)
        fail('capture after final');
      if (a.voidEffects > 1) fail('voided twice');
      if (a.voidEffects > 0 && live.length > 0 && !a.remainderVoided) fail('voided and captured');
      // A reauthorized authorization is closed by PayPal, not by a void (R11-O06).
      if (a.status === 'VOIDED' && a.reauthorizedTo === undefined && a.voidEffects !== 1)
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
    // The funds moved to the new authorization; nothing went back to the payer (R11-O06).
    if (a.reauthorizedTo !== undefined) return 0;
    if (a.status === 'VOIDED' || a.status === 'EXPIRED') {
      return Math.max(0, a.holdCents - FakePayPalCore.capturedOf(a));
    }
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
