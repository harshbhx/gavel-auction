/**
 * Fault injection engine for the fake PayPal (SPEC 3.10 R-PAY-122, taxonomy 4.5).
 *
 * The engine decides which armed fault, if any, hits a call and applies it around
 * a handler that performs the real (in-memory) work. It knows nothing about the
 * core or the HTTP server: the server hands it `(op, authId)` and a handler that
 * returns the normal response, and it returns what goes on the wire.
 *
 * A fault targets `(op, authId | null, times)` with an optional `afterNthCall`:
 * the fault ignores the first n matching calls and fires on the following ones.
 * Timers are injected, so `slow(ms)` and the timeout kinds never use real time in
 * tests.
 */

export const FAULT_KINDS = [
  'timeout_before',
  'timeout_after_success',
  'http_500',
  'http_429',
  'http_401_once',
  'connection_reset',
  'slow',
  'capture_declined',
  'malformed_body',
  'forget_idempotency',
] as const;
export type FaultKind = (typeof FAULT_KINDS)[number];

/** Operations a fault can target; "token" is the OAuth endpoint, which never takes http_401_once. */
export type FaultOp =
  | 'token'
  | 'order'
  | 'get'
  | 'authorize'
  | 'capture'
  | 'void'
  | 'reauthorize'
  | 'verify';

export interface FaultSpec {
  kind: FaultKind;
  /** Operation to hit; "*" matches every operation except "token". */
  op: FaultOp | '*';
  /** Authorization id to hit; null or omitted matches any. */
  authId?: string | null;
  /** How many times the fault fires. Default 1. */
  times?: number;
  /** Skip this many matching calls before the fault starts firing. Default 0. */
  afterNthCall?: number;
  /** slow: response delay in ms. */
  ms?: number;
  /** http_429: Retry-After value in seconds. Default 1. */
  retryAfterSec?: number;
  /** timeout_before and timeout_after_success: how long the connection is held. Default 10000. */
  timeoutMs?: number;
}

export interface FaultTimers {
  sleep(ms: number): Promise<void>;
}

export interface FaultCall {
  op: FaultOp;
  authId: string | null;
}

/** The response the handler produces when nothing interferes. */
export interface HandlerResponse {
  status: number;
  headers?: Record<string, string>;
  body: string;
}

/** What the client observes. */
export type WireResult =
  | { type: 'response'; status: number; headers: Record<string, string>; body: string }
  /** Request received, connection held and then dropped: the client times out. */
  | { type: 'timeout' }
  /** Socket destroyed immediately. */
  | { type: 'reset' };

export interface AppliedFault {
  kind: FaultKind;
  op: FaultOp;
  authId: string | null;
  /** Whether the handler ran, so the effect reached the fake's state. */
  handlerRan: boolean;
}

interface Armed {
  id: number;
  spec: FaultSpec;
  remaining: number;
  /** Matching calls still to skip. */
  skip: number;
}

export interface FaultHooks {
  /** forget_idempotency: clear the fake's idempotency table. */
  forgetIdempotency?: () => void;
}

const DEFAULT_TIMEOUT_MS = 10_000;

function realTimers(): FaultTimers {
  return { sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };
}

function jsonError(status: number, name: string, issue?: string): HandlerResponse {
  const body: Record<string, unknown> = { name, message: name };
  if (issue !== undefined) body['details'] = [{ issue }];
  return { status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

function asWire(r: HandlerResponse): WireResult {
  return { type: 'response', status: r.status, headers: { ...(r.headers ?? {}) }, body: r.body };
}

/** Keeps the first half of the body: valid prefix, invalid JSON. */
function truncate(body: string): string {
  return body.slice(0, Math.max(1, Math.floor(body.length / 2)));
}

export class FaultEngine {
  private armed: Armed[] = [];
  private nextId = 1;
  private readonly timers: FaultTimers;
  private readonly hooks: FaultHooks;
  /** Log of fired faults, in order. */
  readonly applied: AppliedFault[] = [];

  constructor(opts: { timers?: FaultTimers; hooks?: FaultHooks } = {}) {
    this.timers = opts.timers ?? realTimers();
    this.hooks = opts.hooks ?? {};
  }

  /** Arms a fault. Returns its id. */
  add(spec: FaultSpec): number {
    const times = spec.kind === 'http_401_once' ? 1 : (spec.times ?? 1);
    if (!Number.isInteger(times) || times < 1)
      throw new RangeError('times must be an integer >= 1');
    const skip = spec.afterNthCall ?? 0;
    if (!Number.isInteger(skip) || skip < 0) {
      throw new RangeError('afterNthCall must be an integer >= 0');
    }
    if (spec.kind === 'slow' && !(typeof spec.ms === 'number' && spec.ms >= 0)) {
      throw new RangeError('slow needs ms >= 0');
    }
    if (spec.kind === 'capture_declined' && spec.op !== 'capture' && spec.op !== '*') {
      throw new RangeError('capture_declined only applies to capture');
    }
    const id = this.nextId;
    this.nextId += 1;
    this.armed.push({ id, spec, remaining: times, skip });
    return id;
  }

  /** Removes one armed fault, or all of them. */
  clear(id?: number): void {
    this.armed = id === undefined ? [] : this.armed.filter((a) => a.id !== id);
  }

  /** Faults that can still fire. */
  pending(): number {
    return this.armed.filter((a) => a.remaining > 0).length;
  }

  private matches(a: Armed, call: FaultCall): boolean {
    const { spec } = a;
    if (a.remaining <= 0) return false;
    if (call.op === 'token') {
      if (spec.op !== 'token') return false;
    } else if (spec.op !== '*' && spec.op !== call.op) {
      return false;
    }
    if (spec.kind === 'capture_declined' && call.op !== 'capture') return false;
    if (spec.authId !== undefined && spec.authId !== null && spec.authId !== call.authId) {
      return false;
    }
    return true;
  }

  /** The fault that fires for this call, consuming one use, or null. */
  take(call: FaultCall): FaultSpec | null {
    let hit: FaultSpec | null = null;
    for (const a of this.armed) {
      if (!this.matches(a, call)) continue;
      if (a.skip > 0) {
        a.skip -= 1;
        continue;
      }
      if (hit !== null) continue;
      a.remaining -= 1;
      hit = a.spec;
    }
    this.armed = this.armed.filter((a) => a.remaining > 0);
    return hit;
  }

  /**
   * Runs one call. `handler` does the normal work and must not run for the faults
   * that say "not applied".
   */
  async apply(
    call: FaultCall,
    handler: () => HandlerResponse | Promise<HandlerResponse>,
  ): Promise<WireResult> {
    const spec = this.take(call);
    if (spec === null) return asWire(await handler());

    const record = (handlerRan: boolean): void => {
      this.applied.push({ kind: spec.kind, op: call.op, authId: call.authId, handlerRan });
    };
    const timeoutMs = spec.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    switch (spec.kind) {
      case 'timeout_before':
        record(false);
        await this.timers.sleep(timeoutMs);
        return { type: 'timeout' };
      case 'timeout_after_success': {
        await handler();
        record(true);
        await this.timers.sleep(timeoutMs);
        return { type: 'timeout' };
      }
      case 'http_500':
        record(false);
        return asWire(jsonError(500, 'INTERNAL_SERVICE_ERROR'));
      case 'http_429': {
        record(false);
        const r = jsonError(429, 'RATE_LIMIT_REACHED');
        r.headers = { ...r.headers, 'retry-after': String(spec.retryAfterSec ?? 1) };
        return asWire(r);
      }
      case 'http_401_once':
        record(false);
        return asWire(jsonError(401, 'AUTHENTICATION_FAILURE'));
      case 'connection_reset':
        record(false);
        return { type: 'reset' };
      case 'slow': {
        const r = await handler();
        record(true);
        await this.timers.sleep(spec.ms ?? 0);
        return asWire(r);
      }
      case 'capture_declined':
        record(false);
        return asWire(jsonError(422, 'UNPROCESSABLE_ENTITY', 'INSTRUMENT_DECLINED'));
      case 'malformed_body': {
        const r = await handler();
        record(true);
        return asWire({ ...r, status: r.status < 300 ? 200 : r.status, body: truncate(r.body) });
      }
      case 'forget_idempotency': {
        const r = await handler();
        record(true);
        this.hooks.forgetIdempotency?.();
        return asWire(r);
      }
    }
  }
}
