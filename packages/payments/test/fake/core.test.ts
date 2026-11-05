import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  defaultCaptureLimit,
  FakeApiError,
  FakeClock,
  FakePayPalCore,
  FakeTimeout,
  type FakeCoreOptions,
} from '../../src/fake/core.js';

function mk(opts: FakeCoreOptions = {}): { pp: FakePayPalCore; clock: FakeClock } {
  const clock = new FakeClock();
  return { pp: new FakePayPalCore({ ...opts, clock }), clock };
}

function apiError(fn: () => unknown): FakeApiError {
  try {
    fn();
  } catch (e) {
    if (e instanceof FakeApiError) return e;
    throw e;
  }
  throw new Error('expected a FakeApiError');
}

function timesOut(fn: () => unknown): boolean {
  try {
    fn();
  } catch (e) {
    if (e instanceof FakeTimeout) return true;
    throw e;
  }
  return false;
}

describe('ported prototype cases', () => {
  it('partial final capture releases the remainder', () => {
    const { pp } = mk();
    const a = pp.createAuthorization('p', 1000).id;
    pp.capture(a, 600, true, 'r1');
    const g = pp.getAuthorization(a);
    expect(g.status).toBe('CAPTURED');
    expect(g.capturedCents).toBe(600);
    expect(pp.released(a)).toBe(400);
    apiError(() => pp.capture(a, 100, true, 'r2'));
    apiError(() => pp.void(a, 'v'));
    expect(pp.checkInvariants()).toBe(true);
  });

  it('non-final captures accumulate to the cap', () => {
    const { pp } = mk();
    const a = pp.createAuthorization('p', 1000).id;
    pp.capture(a, 600, false, 'r1');
    pp.capture(a, 550, false, 'r2'); // 1150 = 115% of 1000
    expect(apiError(() => pp.capture(a, 1, false, 'r3')).issue).toBe(
      'CAPTURE_AMOUNT_EXCEEDS_LIMIT',
    );
    expect(() => pp.checkInvariants()).toThrow('above the authorized ceiling');
    pp.checkInvariants({ allowOverCapture: true });
  });

  it('over-capture cap is min(115%, +$75)', () => {
    const { pp } = mk();
    const a = pp.createAuthorization('p', 100000).id; // $1000: +$75 binds
    apiError(() => pp.capture(a, 107501, true, 'x'));
    pp.capture(a, 107500, true, 'y');
    expect(defaultCaptureLimit(1000)).toBe(1150);
    expect(defaultCaptureLimit(100000)).toBe(107500);
  });

  it('void and double void', () => {
    const { pp } = mk();
    const a = pp.createAuthorization('p', 500).id;
    pp.void(a, 'v1');
    expect(apiError(() => pp.void(a, 'v2')).issue).toBe('AUTHORIZATION_ALREADY_VOIDED');
    expect(pp.inspect(a).voidEffects).toBe(1);
    expect(apiError(() => pp.capture(a, 100, true, 'c')).issue).toBe('AUTHORIZATION_VOIDED');
  });

  it('idempotent capture replay and parameter mismatch', () => {
    const { pp } = mk();
    const a = pp.createAuthorization('p', 1000).id;
    const r1 = pp.capture(a, 300, true, 'same');
    const r2 = pp.capture(a, 300, true, 'same');
    expect(r2).toEqual(r1);
    expect(pp.getAuthorization(a).captures).toHaveLength(1);
    expect(pp.events.filter((e) => e.eventType === 'PAYMENT.CAPTURE.COMPLETED')).toHaveLength(1);
    expect(apiError(() => pp.capture(a, 301, true, 'same')).issue).toBe(
      'DUPLICATE_REQUEST_ID_DIFFERENT_PARAMS',
    );
  });

  it('timeout after success, then a retry with the same key does not double capture', () => {
    const { pp } = mk();
    const a = pp.createAuthorization('p', 1000).id;
    pp.inject('capture', 'timeout_after_success');
    expect(timesOut(() => pp.capture(a, 300, true, 'k'))).toBe(true);
    expect(pp.inspect(a).capturedCents).toBe(300); // it did happen
    pp.capture(a, 300, true, 'k');
    expect(pp.inspect(a).capturedCents).toBe(300);
  });

  it('timeout before means not applied', () => {
    const { pp } = mk();
    const a = pp.createAuthorization('p', 1000).id;
    pp.inject('capture', 'timeout_before');
    expect(timesOut(() => pp.capture(a, 300, true, 'k'))).toBe(true);
    expect(pp.inspect(a).capturedCents).toBe(0);
  });

  it('injected decline and 500', () => {
    const { pp } = mk();
    const a = pp.createAuthorization('p', 1000).id;
    pp.inject('capture', 'capture_declined');
    expect(apiError(() => pp.capture(a, 100, true, 'k1')).issue).toBe('INSTRUMENT_DECLINED');
    expect(pp.inspect(a).capturedCents).toBe(0);
    pp.inject('capture', 'http_500');
    expect(apiError(() => pp.capture(a, 100, true, 'k2')).status).toBe(500);
  });

  it('faults reach reads and cover 429, connection reset and forgotten idempotency', () => {
    const { pp } = mk();
    const a = pp.createAuthorization('p', 1000).id;
    pp.inject('get', 'timeout_before', a);
    expect(timesOut(() => pp.getAuthorization(a))).toBe(true);
    expect(pp.getAuthorization(a).status).toBe('CREATED'); // the fault fired once
    pp.inject('get', 'http_500', a);
    expect(apiError(() => pp.getAuthorization(a)).status).toBe(500);
    pp.inject('get', 'connection_reset', a);
    expect(timesOut(() => pp.getAuthorization(a))).toBe(true);
    pp.inject('capture', 'http_429', a);
    expect(apiError(() => pp.capture(a, 100, true, 'k')).status).toBe(429);
    expect(pp.inspect(a).capturedCents).toBe(0);
    // timeout after success, then the server forgets the request id: the retry captures again
    pp.inject('capture', 'timeout_after_success', a);
    expect(timesOut(() => pp.capture(a, 100, false, 'k2'))).toBe(true);
    pp.inject('capture', 'forget_idempotency', a);
    pp.capture(a, 100, false, 'k2');
    expect(pp.inspect(a).capturedCents).toBe(200);
  });

  it('inject refuses fault and operation pairs that make no sense', () => {
    const { pp } = mk();
    expect(() => pp.inject('void', 'capture_declined')).toThrow(/only applies to capture/);
    expect(() => pp.inject('get', 'forget_idempotency')).toThrow(/does not apply to reads/);
  });

  it('webhook duplicate and out-of-order delivery', () => {
    const { pp } = mk();
    const a = pp.createAuthorization('p', 1000).id;
    const b = pp.createAuthorization('q', 1000).id;
    pp.capture(a, 100, true, 'k');
    pp.void(b, 'v');
    expect(pp.deliver('fifo')).toHaveLength(2);
    expect(pp.deliver('shuffle', { duplicate: true, seed: 3 })).toHaveLength(4);
    expect(pp.deliver('reverse').map((e) => e.id)).toEqual(
      pp
        .deliver('fifo')
        .map((e) => e.id)
        .reverse(),
    );
  });
});

describe('T-PAY-077 clock, honor and validity boundaries', () => {
  it('afterHonorCapture "fail": capture inside honor works, after honor fails', () => {
    const { pp, clock } = mk({ afterHonorCapture: 'fail' });
    const a = pp.createAuthorization('p', 1000).id;
    clock.advance(2 * DAY_MS);
    pp.capture(a, 100, false, 'in-honor');
    clock.advance(2 * DAY_MS);
    expect(apiError(() => pp.capture(a, 100, true, 'late')).issue).toContain('HONOR');
  });

  it('the honor boundary is inclusive: exactly 3 days still works', () => {
    const { pp, clock } = mk({ afterHonorCapture: 'fail' });
    const a = pp.createAuthorization('p', 1000).id;
    clock.advance(3 * DAY_MS);
    pp.capture(a, 100, true, 'edge');
    const b = pp.createAuthorization('p', 1000).id;
    clock.advance(3 * DAY_MS + 1);
    apiError(() => pp.capture(b, 100, true, 'edge+1'));
  });

  it('afterHonorCapture "ok" (default): capture after honor still works', () => {
    const { pp, clock } = mk();
    const b = pp.createAuthorization('p', 1000).id;
    clock.advance(10 * DAY_MS);
    pp.capture(b, 100, true, 'late-ok');
  });

  it('authorization expires after validity, emits a VOIDED event and releases the hold', () => {
    const { pp, clock } = mk();
    const d = pp.createAuthorization('p', 1000).id;
    clock.advance(29 * DAY_MS);
    expect(pp.getAuthorization(d).status).toBe('CREATED'); // exactly 29 days: alive
    clock.advance(30 * DAY_MS);
    expect(apiError(() => pp.capture(d, 100, true, 'x')).issue).toBe('AUTHORIZATION_EXPIRED');
    expect(pp.events.some((e) => e.eventType === 'PAYMENT.AUTHORIZATION.VOIDED')).toBe(true);
    expect(pp.events.filter((e) => e.eventType === 'PAYMENT.AUTHORIZATION.VOIDED')).toHaveLength(1);
    expect(pp.released(d)).toBe(1000);
  });

  it('reauthorize window and renewed validity', () => {
    const { pp, clock } = mk();
    const a = pp.createAuthorization('p', 1000).id;
    apiError(() => pp.reauthorize(a, 1000, 'r')); // day 0: too early
    clock.advance(5 * DAY_MS);
    const renewed = pp.reauthorize(a, 1000, 'r2');
    expect(pp.inspect(a).reauths).toBe(1);
    clock.advance(26 * DAY_MS); // 26 days after reauth (< 29): alive
    pp.capture(renewed.id, 1000, true, 'c');
    pp.checkInvariants();
  });

  it('R11-O06 reauthorize issues a new authorization id and closes the old one', () => {
    const { pp, clock } = mk();
    const a = pp.createAuthorization('p', 1000).id;
    clock.advance(4 * DAY_MS);
    const renewed = pp.reauthorize(a, 900, 'r');
    expect(renewed.id).not.toBe(a);
    expect(pp.getAuthorization(renewed.id)).toMatchObject({ status: 'CREATED', holdCents: 900 });
    expect(pp.getAuthorization(a).status).toBe('VOIDED');
    expect(apiError(() => pp.capture(a, 900, true, 'old')).issue).toBe('AUTHORIZATION_VOIDED');
    expect(pp.reauthorizationChain(renewed.id)).toEqual([a, renewed.id]);
    // The same request id replays the same answer: one new authorization only.
    expect(pp.reauthorize(a, 900, 'r').id).toBe(renewed.id);
    expect(pp.released(a)).toBe(0);
    pp.capture(renewed.id, 900, true, 'new');
    expect(pp.checkInvariants()).toBe(true);
  });

  it('R11-O03 a pending capture can complete, or be declined and leave the hold open', () => {
    const { pp } = mk();
    const a = pp.createAuthorization('p', 1000).id;
    pp.inject('capture', 'capture_pending', a);
    const c = pp.capture(a, 600, true, 'c1');
    expect(c.status).toBe('PENDING');
    expect(pp.getAuthorization(a).captures[0]?.status).toBe('PENDING');
    pp.denyCapture(c.id);
    expect(pp.getAuthorization(a)).toMatchObject({ status: 'CREATED', capturedCents: 0 });
    expect(pp.events.map((e) => e.eventType)).toContain('PAYMENT.CAPTURE.DENIED');
    expect(apiError(() => pp.completeCapture(c.id)).issue).toBe('CAPTURE_NOT_PENDING');

    const b = pp.createAuthorization('p', 1000).id;
    pp.inject('capture', 'capture_pending', b);
    const d = pp.capture(b, 700, true, 'c2');
    pp.completeCapture(d.id);
    expect(pp.getAuthorization(b)).toMatchObject({ status: 'CAPTURED', capturedCents: 700 });
    expect(pp.checkInvariants()).toBe(true);
  });

  it('a partially captured authorization with a final capture does not expire', () => {
    const { pp, clock } = mk();
    const a = pp.createAuthorization('p', 1000).id;
    pp.capture(a, 400, true, 'f');
    clock.advance(40 * DAY_MS);
    expect(pp.getAuthorization(a).status).toBe('CAPTURED');
  });

  it('configurable validity and honor periods', () => {
    const { pp, clock } = mk({ honorMs: 1000, validityMs: 5000, afterHonorCapture: 'fail' });
    const a = pp.createAuthorization('p', 100).id;
    clock.advance(1001);
    apiError(() => pp.capture(a, 10, true, 'k'));
    clock.advance(5000);
    expect(apiError(() => pp.capture(a, 10, true, 'k2')).issue).toBe('AUTHORIZATION_EXPIRED');
  });

  it('autoReleaseRemainder false: the remainder stays held until an explicit void', () => {
    const { pp } = mk({ autoReleaseRemainder: false });
    const a = pp.createAuthorization('p', 1000).id;
    pp.capture(a, 600, true, 'c');
    expect(pp.released(a)).toBe(0);
    pp.void(a, 'v');
    expect(pp.released(a)).toBe(400);
    expect(pp.getAuthorization(a).status).toBe('CAPTURED');
    apiError(() => pp.void(a, 'v2'));
    expect(pp.checkInvariants()).toBe(true);
  });

  it('invariants reject a capture above the authorized ceiling even within the over-capture limit', () => {
    const { pp } = mk();
    const a = pp.createAuthorization('p', 10000).id;
    pp.capture(a, 11400, true, 'over'); // within hold + 15%, above what the buyer authorized
    expect(() => pp.checkInvariants()).toThrow('above the authorized ceiling');
  });

  it('reauthorize rejects zero, negative, NaN and non-integer amounts', () => {
    const { pp, clock } = mk();
    const a = pp.createAuthorization('p', 1000).id;
    clock.advance(5 * DAY_MS);
    for (const bad of [0, -5, Number.NaN, 10.5, Number.POSITIVE_INFINITY]) {
      expect(apiError(() => pp.reauthorize(a, bad, `r${String(bad)}`)).status).toBe(400);
    }
    expect(pp.getAuthorization(a).holdCents).toBe(1000);
  });

  it('reauthorize cannot shrink below the captured total or rise above the ceiling', () => {
    const { pp, clock } = mk();
    const a = pp.createAuthorization('p', 1000).id;
    pp.capture(a, 600, false, 'c1');
    clock.advance(5 * DAY_MS);
    expect(apiError(() => pp.reauthorize(a, 500, 'low')).issue).toBe(
      'REAUTHORIZATION_BELOW_CAPTURED',
    );
    expect(apiError(() => pp.reauthorize(a, 1001, 'high')).issue).toBe(
      'REAUTHORIZATION_AMOUNT_EXCEEDS_LIMIT',
    );
    pp.reauthorize(a, 800, 'ok');
    expect(pp.checkInvariants()).toBe(true);
  });

  it('voiding a partially captured authorization releases only the remainder and passes the invariants', () => {
    const { pp } = mk();
    const a = pp.createAuthorization('p', 1000).id;
    pp.capture(a, 300, false, 'c1');
    pp.void(a, 'v');
    expect(pp.released(a)).toBe(700);
    expect(pp.checkInvariants()).toBe(true);
    expect(apiError(() => pp.capture(a, 10, false, 'c2')).issue).toBe('AUTHORIZATION_VOIDED');
  });

  it('captureLimit is configurable', () => {
    const { pp } = mk({ captureLimit: (h) => h });
    const a = pp.createAuthorization('p', 1000).id;
    apiError(() => pp.capture(a, 1001, true, 'x'));
    pp.capture(a, 1000, true, 'y');
  });

  it('capture of zero or negative is rejected', () => {
    const { pp } = mk();
    const a = pp.createAuthorization('p', 1000).id;
    expect(apiError(() => pp.capture(a, 0, true, 'x')).status).toBe(400);
    expect(apiError(() => pp.capture(a, -5, true, 'y')).status).toBe(400);
  });

  it('unknown authorization is a 404', () => {
    const { pp } = mk();
    expect(apiError(() => pp.getAuthorization('AUTH-99')).status).toBe(404);
  });
});

describe('orders', () => {
  it('create, approve, authorize, then capture', () => {
    const { pp } = mk();
    const o = pp.createOrder({ holdId: 'h1', amountCents: 5000, description: 'hold' }, 'req-o');
    expect(o.id).toBe('ORDER-1');
    expect(o.approveUrl).toContain('ORDER-1');
    expect(apiError(() => pp.authorizeOrder(o.id, 'req-a')).issue).toBe('ORDER_NOT_APPROVED');
    pp.approveOrder(o.id);
    expect(pp.getOrder(o.id).status).toBe('APPROVED');
    const auth = pp.authorizeOrder(o.id, 'req-a2');
    expect(auth.authId).toBe('AUTH-1');
    expect(pp.getOrder(o.id)).toMatchObject({ status: 'COMPLETED', authId: 'AUTH-1' });
    expect(apiError(() => pp.authorizeOrder(o.id, 'req-a3')).issue).toBe(
      'ORDER_ALREADY_AUTHORIZED',
    );
    pp.capture(auth.authId, 5000, true, 'c');
    expect(pp.getAuthorization(auth.authId).capturedCents).toBe(5000);
  });

  it('createOrder replays by request id and rejects changed params', () => {
    const { pp } = mk();
    const a = pp.createOrder({ holdId: 'h1', amountCents: 5000 }, 'same');
    const b = pp.createOrder({ holdId: 'h1', amountCents: 5000 }, 'same');
    expect(b).toEqual(a);
    expect(apiError(() => pp.createOrder({ holdId: 'h1', amountCents: 6000 }, 'same')).issue).toBe(
      'DUPLICATE_REQUEST_ID_DIFFERENT_PARAMS',
    );
  });

  it('authorize replay returns the same authorization, a lost response is recoverable', () => {
    const { pp } = mk();
    const o = pp.createOrder({ holdId: 'h1', amountCents: 5000 }, 'o');
    pp.approveOrder(o.id);
    pp.inject('authorize', 'timeout_after_success');
    expect(timesOut(() => pp.authorizeOrder(o.id, 'a'))).toBe(true);
    expect(pp.authCount()).toBe(1);
    expect(pp.authorizeOrder(o.id, 'a').authId).toBe('AUTH-1');
    expect(pp.authCount()).toBe(1);
  });

  it('rejects non-positive order amounts and unknown orders', () => {
    const { pp } = mk();
    expect(apiError(() => pp.createOrder({ holdId: 'h', amountCents: 0 })).status).toBe(400);
    expect(apiError(() => pp.getOrder('ORDER-9')).status).toBe(404);
  });
});

describe('determinism', () => {
  function script(seed: number): { ids: string[]; shuffled: string[]; events: string[] } {
    const { pp, clock } = mk({ seed });
    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const o = pp.createOrder({ holdId: `h${i}`, amountCents: 1000 * (i + 1) }, `o${i}`);
      pp.approveOrder(o.id);
      const a = pp.authorizeOrder(o.id, `a${i}`);
      ids.push(o.id, a.authId);
      if (i % 2 === 0) ids.push(pp.capture(a.authId, 500, true, `c${i}`).id);
      else pp.void(a.authId, `v${i}`);
    }
    clock.advance(DAY_MS);
    return {
      ids,
      shuffled: pp.deliver('shuffle', { duplicate: true }).map((e) => e.id),
      events: pp.events.map((e) => `${e.id}:${e.eventType}`),
    };
  }

  it('same seed and call sequence give identical ids and webhook order', () => {
    expect(script(7)).toEqual(script(7));
  });

  it('ids are sequential per kind', () => {
    const { ids } = script(1);
    expect(ids.slice(0, 3)).toEqual(['ORDER-1', 'AUTH-1', 'CAP-1']);
  });

  it('different seeds shuffle differently', () => {
    const orders = new Set<string>();
    for (let seed = 0; seed < 8; seed += 1) orders.add(script(seed).shuffled.join(','));
    expect(orders.size).toBeGreaterThan(1);
  });

  it('shuffle is a permutation of fifo', () => {
    const { pp } = mk({ seed: 5 });
    for (let i = 0; i < 6; i += 1)
      pp.capture(pp.createAuthorization('p', 1000).id, 100, true, `k${i}`);
    const fifo = pp.deliver('fifo').map((e) => e.id);
    const sh = pp.deliver('shuffle').map((e) => e.id);
    expect([...sh].sort()).toEqual([...fifo].sort());
  });
});
