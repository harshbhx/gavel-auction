import { describe, expect, it } from 'vitest';
import { classifyError } from '../../src/errorMap.js';
import { FakeApiError, FakeClock, FakePayPalCore } from '../../src/fake/core.js';
import {
  FAULT_KINDS,
  FaultEngine,
  type FaultCall,
  type FaultKind,
  type HandlerResponse,
  type WireResult,
} from '../../src/fake/faults.js';

interface Rig {
  core: FakePayPalCore;
  engine: FaultEngine;
  sleeps: number[];
  authId: string;
  capture(requestId: string, amountCents?: number): Promise<WireResult>;
}

function rig(): Rig {
  const core = new FakePayPalCore({ clock: new FakeClock() });
  const sleeps: number[] = [];
  const engine = new FaultEngine({
    timers: {
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    },
    hooks: { forgetIdempotency: () => core.forgetIdempotency() },
  });
  const authId = core.createAuthorization('buyer', 1000).id;
  const capture = (requestId: string, amountCents = 600): Promise<WireResult> =>
    engine.apply({ op: 'capture', authId }, () => {
      try {
        const r = core.capture(authId, amountCents, true, requestId);
        return { status: 201, body: JSON.stringify(r) };
      } catch (e) {
        if (e instanceof FakeApiError) {
          return {
            status: e.status,
            body: JSON.stringify({ name: 'UNPROCESSABLE_ENTITY', details: [{ issue: e.issue }] }),
          };
        }
        throw e;
      }
    });
  return { core, engine, sleeps, authId, capture };
}

function response(r: WireResult): Extract<WireResult, { type: 'response' }> {
  if (r.type !== 'response') throw new Error(`expected a response, got ${r.type}`);
  return r;
}

describe('T-PAY-075 every fault kind applied once to capture', () => {
  it('lists the ten kinds of SPEC 4.5', () => {
    expect([...FAULT_KINDS]).toEqual([
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
    ]);
  });

  it('timeout_before: held then dropped, not applied', async () => {
    const r = rig();
    r.engine.add({ kind: 'timeout_before', op: 'capture', timeoutMs: 5000 });
    expect((await r.capture('r1')).type).toBe('timeout');
    expect(r.sleeps).toEqual([5000]);
    expect(r.core.inspect(r.authId).capturedCents).toBe(0);
    expect(r.engine.applied[0]).toMatchObject({ kind: 'timeout_before', handlerRan: false });
  });

  it('timeout_after_success: applied and remembered, response dropped', async () => {
    const r = rig();
    r.engine.add({ kind: 'timeout_after_success', op: 'capture' });
    expect((await r.capture('r1')).type).toBe('timeout');
    expect(r.sleeps).toEqual([10_000]);
    expect(r.core.inspect(r.authId).capturedCents).toBe(600);
    const replay = response(await r.capture('r1'));
    expect(replay.status).toBe(201);
    expect(r.core.inspect(r.authId).capturedCents).toBe(600);
    expect(r.engine.applied[0]).toMatchObject({ handlerRan: true });
  });

  it('http_500: 500 INTERNAL_SERVICE_ERROR, not applied', async () => {
    const r = rig();
    r.engine.add({ kind: 'http_500', op: 'capture' });
    const res = response(await r.capture('r1'));
    expect(res.status).toBe(500);
    expect(classifyError(res.status, res.headers, res.body)).toMatchObject({
      kind: 'server_error',
      outcome: 'unknown',
      name: 'INTERNAL_SERVICE_ERROR',
    });
    expect(r.core.inspect(r.authId).capturedCents).toBe(0);
  });

  it('http_429: Retry-After header, not applied', async () => {
    const r = rig();
    r.engine.add({ kind: 'http_429', op: 'capture', retryAfterSec: 3 });
    const res = response(await r.capture('r1'));
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBe('3');
    expect(classifyError(res.status, res.headers, res.body).kind).toBe('rate_limited');
    expect(r.core.inspect(r.authId).capturedCents).toBe(0);
  });

  it('http_401_once: next business call gets 401, the token endpoint still works', async () => {
    const r = rig();
    r.engine.add({ kind: 'http_401_once', op: '*', times: 5 });
    const token = await r.engine.apply({ op: 'token', authId: null }, () => ({
      status: 200,
      body: '{"access_token":"x","expires_in":3600}',
    }));
    expect(response(token).status).toBe(200);
    const first = response(await r.capture('r1'));
    expect(first.status).toBe(401);
    expect(classifyError(401, first.headers, first.body).kind).toBe('auth_expired');
    expect(r.core.inspect(r.authId).capturedCents).toBe(0);
    // once: the replay after the token refresh goes through
    expect(response(await r.capture('r1')).status).toBe(201);
  });

  it('connection_reset: socket destroyed, not applied', async () => {
    const r = rig();
    r.engine.add({ kind: 'connection_reset', op: 'capture' });
    expect((await r.capture('r1')).type).toBe('reset');
    expect(r.core.inspect(r.authId).capturedCents).toBe(0);
  });

  it('slow(ms): applied, response delayed on the injected timer', async () => {
    const r = rig();
    r.engine.add({ kind: 'slow', op: 'capture', ms: 2500 });
    const res = response(await r.capture('r1'));
    expect(res.status).toBe(201);
    expect(r.sleeps).toEqual([2500]);
    expect(r.core.inspect(r.authId).capturedCents).toBe(600);
  });

  it('capture_declined: 422 INSTRUMENT_DECLINED, not applied', async () => {
    const r = rig();
    r.engine.add({ kind: 'capture_declined', op: 'capture' });
    const res = response(await r.capture('r1'));
    expect(res.status).toBe(422);
    expect(classifyError(res.status, res.headers, res.body)).toMatchObject({
      kind: 'declined',
      outcome: 'definite',
    });
    expect(r.core.inspect(r.authId).capturedCents).toBe(0);
  });

  it('malformed_body: 200 with truncated JSON, applied', async () => {
    const r = rig();
    r.engine.add({ kind: 'malformed_body', op: 'capture' });
    const res = response(await r.capture('r1'));
    expect(res.status).toBe(200);
    expect(() => JSON.parse(res.body)).toThrow();
    expect(r.core.inspect(r.authId).capturedCents).toBe(600);
  });

  it('forget_idempotency: a replay with the same request id is no longer recognised', async () => {
    const r = rig();
    r.engine.add({ kind: 'forget_idempotency', op: 'capture' });
    expect(response(await r.capture('r1')).status).toBe(201);
    const replay = response(await r.capture('r1'));
    expect(replay.status).toBe(422);
    expect(replay.body).toContain('AUTHORIZATION_ALREADY_CAPTURED');
    expect(r.core.inspect(r.authId).capturedCents).toBe(600);
  });

  it('every kind fires exactly once and then the call is normal', async () => {
    for (const kind of FAULT_KINDS) {
      const r = rig();
      r.engine.add({ kind, op: 'capture', ms: 1 });
      await r.capture('r1');
      expect(r.engine.applied.map((a) => a.kind)).toEqual([kind]);
      expect(r.engine.pending()).toBe(0);
    }
  });
});

describe('fault targeting', () => {
  const call = (op: FaultCall['op'], authId: string | null = null): FaultCall => ({ op, authId });
  const ok = (): HandlerResponse => ({ status: 200, body: '{}' });

  it('matches by op', async () => {
    const e = new FaultEngine();
    e.add({ kind: 'http_500', op: 'void' });
    expect(response(await e.apply(call('capture', 'A'), ok)).status).toBe(200);
    expect(response(await e.apply(call('void', 'A'), ok)).status).toBe(500);
  });

  it('matches by authId, null matches any', async () => {
    const e = new FaultEngine();
    e.add({ kind: 'http_500', op: 'capture', authId: 'AUTH-2' });
    expect(response(await e.apply(call('capture', 'AUTH-1'), ok)).status).toBe(200);
    expect(response(await e.apply(call('capture', 'AUTH-2'), ok)).status).toBe(500);
    e.add({ kind: 'http_500', op: 'capture', authId: null });
    expect(response(await e.apply(call('capture', 'AUTH-9'), ok)).status).toBe(500);
  });

  it('fires times times', async () => {
    const e = new FaultEngine();
    e.add({ kind: 'http_500', op: 'capture', times: 2 });
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      statuses.push(response(await e.apply(call('capture', 'A'), ok)).status);
    }
    expect(statuses).toEqual([500, 500, 200, 200]);
  });

  it('afterNthCall skips that many matching calls first', async () => {
    const e = new FaultEngine();
    e.add({ kind: 'http_500', op: 'capture', afterNthCall: 2 });
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      await e.apply(call('void', 'A'), ok); // other ops do not count
      statuses.push(response(await e.apply(call('capture', 'A'), ok)).status);
    }
    expect(statuses).toEqual([200, 200, 500, 200]);
  });

  it('op "*" never hits the token endpoint', async () => {
    const e = new FaultEngine();
    e.add({ kind: 'http_500', op: '*', times: 3 });
    expect(response(await e.apply(call('token'), ok)).status).toBe(200);
    expect(response(await e.apply(call('get', 'A'), ok)).status).toBe(500);
  });

  it('applies faults in the order they were armed', async () => {
    const e = new FaultEngine();
    e.add({ kind: 'http_500', op: 'capture' });
    e.add({ kind: 'http_429', op: 'capture' });
    const kinds: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      kinds.push(response(await e.apply(call('capture', 'A'), ok)).status);
    }
    expect(kinds).toEqual([500, 429, 200]);
  });

  it('clear removes one or all faults', async () => {
    const e = new FaultEngine();
    const a = e.add({ kind: 'http_500', op: 'capture' });
    e.add({ kind: 'http_429', op: 'capture' });
    e.clear(a);
    expect(response(await e.apply(call('capture', 'A'), ok)).status).toBe(429);
    e.add({ kind: 'http_500', op: 'capture' });
    e.clear();
    expect(e.pending()).toBe(0);
  });

  it('rejects bad specs', () => {
    const e = new FaultEngine();
    expect(() => e.add({ kind: 'http_500', op: 'capture', times: 0 })).toThrow(RangeError);
    expect(() => e.add({ kind: 'http_500', op: 'capture', afterNthCall: -1 })).toThrow(RangeError);
    expect(() => e.add({ kind: 'slow', op: 'capture' })).toThrow(RangeError);
    expect(() => e.add({ kind: 'capture_declined', op: 'void' })).toThrow(RangeError);
  });

  it('does not run the handler for not-applied kinds', async () => {
    const kinds: FaultKind[] = [
      'timeout_before',
      'http_500',
      'http_429',
      'http_401_once',
      'connection_reset',
      'capture_declined',
    ];
    for (const kind of kinds) {
      const e = new FaultEngine({ timers: { sleep: async () => undefined } });
      e.add({ kind, op: 'capture' });
      let ran = false;
      await e.apply(call('capture', 'A'), () => {
        ran = true;
        return ok();
      });
      expect(ran, kind).toBe(false);
    }
  });
});
