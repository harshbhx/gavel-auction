import { describe, expect, it } from 'vitest';
import { classifyError } from '../../src/errorMap.js';
import { FakeApiError, FakeClock, FakePayPalCore } from '../../src/fake/core.js';
import { IdempotencyConflict, IdempotencyTable } from '../../src/fake/idempotency.js';

describe('IdempotencyTable', () => {
  it('replays equal params, conflicts on different params, clears', () => {
    const t = new IdempotencyTable();
    expect(t.replay('k', 'p')).toBeUndefined();
    t.store('k', 'p', { id: 1 });
    expect(t.replay('k', 'p')).toEqual({ id: 1 });
    expect(() => t.replay('k', 'other')).toThrow(IdempotencyConflict);
    expect(t.size()).toBe(1);
    t.clear();
    expect(t.replay('k', 'other')).toBeUndefined();
  });

  it('returns copies of stored results', () => {
    const t = new IdempotencyTable();
    const r = { n: 1 };
    t.store('k', 'p', r);
    r.n = 2;
    const got = t.replay<{ n: number }>('k', 'p');
    expect(got).toEqual({ n: 1 });
    if (got !== undefined) got.n = 3;
    expect(t.replay('k', 'p')).toEqual({ n: 1 });
  });
});

describe('fake idempotency semantics', () => {
  function mk(): FakePayPalCore {
    return new FakePayPalCore({ clock: new FakeClock() });
  }

  it('T-PAY-076: same request id with different params is a 422 that maps to idempotency_conflict', () => {
    const core = mk();
    const a = core.createAuthorization('p', 1000).id;
    core.capture(a, 300, true, 'same');
    let err: unknown;
    try {
      core.capture(a, 301, true, 'same');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(FakeApiError);
    const api = err as FakeApiError;
    expect(api.status).toBe(422);
    const mapped = classifyError(
      api.status,
      {},
      JSON.stringify({ name: 'UNPROCESSABLE_ENTITY', details: [{ issue: api.issue }] }),
    );
    expect(mapped.kind).toBe('idempotency_conflict');
    expect(mapped.outcome).toBe('definite');
  });

  it('keys are per operation and per authorization', () => {
    const core = mk();
    const a = core.createAuthorization('p', 1000).id;
    const b = core.createAuthorization('q', 1000).id;
    core.capture(a, 100, false, 'k');
    expect(() => core.capture(b, 200, false, 'k')).not.toThrow();
    expect(core.inspect(b).capturedCents).toBe(200);
  });

  it('a replay does not repeat the effect or the webhook', () => {
    const core = mk();
    const a = core.createAuthorization('p', 1000).id;
    core.capture(a, 300, true, 'k');
    core.capture(a, 300, true, 'k');
    expect(core.inspect(a).capturedCents).toBe(300);
    expect(core.events.filter((e) => e.eventType === 'PAYMENT.CAPTURE.COMPLETED')).toHaveLength(1);
  });

  it('forgetIdempotency makes a replay behave like a new request', () => {
    const core = mk();
    const a = core.createAuthorization('p', 1000).id;
    core.capture(a, 300, false, 'k');
    core.forgetIdempotency();
    core.capture(a, 300, false, 'k');
    expect(core.inspect(a).capturedCents).toBe(600);
  });
});
