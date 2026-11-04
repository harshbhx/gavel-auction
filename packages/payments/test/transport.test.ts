import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PayPalError } from '../src/errors.js';
import { clearRegisteredSecrets, setLogSink } from '../src/log.js';
import { createMetrics } from '../src/metrics.js';
import {
  Transport,
  parseRetryAfter,
  type FetchLike,
  type TransportInit,
  type TransportOptions,
} from '../src/transport.js';

interface Scripted {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  throws?: string;
}

interface Harness {
  transport: Transport;
  sleeps: number[];
  calls: Array<{ url: string; init: TransportInit }>;
  logs: Array<Record<string, unknown>>;
}

let logs: Array<Record<string, unknown>> = [];
let restoreSink: ((line: string) => void) | undefined;

beforeEach(() => {
  logs = [];
  restoreSink = setLogSink((line) => logs.push(JSON.parse(line) as Record<string, unknown>));
});

afterEach(() => {
  if (restoreSink !== undefined) setLogSink(restoreSink);
  clearRegisteredSecrets();
});

function harness(
  script: Scripted[],
  opts: Partial<TransportOptions> = {},
  rand = 0.999999,
): Harness {
  const sleeps: number[] = [];
  const calls: Harness['calls'] = [];
  let i = 0;
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const step = script[Math.min(i, script.length - 1)];
    i += 1;
    if (step === undefined) throw new Error('empty script');
    if (step.throws !== undefined) throw new Error(step.throws);
    const res = new Response(step.body ?? '{}', {
      status: step.status ?? 200,
      headers: step.headers ?? {},
    });
    return { status: res.status, headers: res.headers, text: () => res.text() };
  };
  const transport = new Transport({
    fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => rand,
    now: () => 1_000_000,
    ...opts,
  });
  return { transport, sleeps, calls, logs };
}

const REQ = {
  method: 'POST',
  url: 'http://127.0.0.1/v2/payments/authorizations/AUTH-1/capture',
  op: 'capture',
  requestId: 'gv1-AAAA',
  body: '{}',
};

async function failure(p: Promise<unknown>): Promise<PayPalError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof PayPalError) return e;
    throw e;
  }
  throw new Error('expected a PayPalError');
}

describe('T-PAY-010 retry with full jitter', () => {
  it('retries http_500 twice then succeeds with the same request id', async () => {
    const h = harness([{ status: 500 }, { status: 500 }, { status: 201, body: '{"id":"CAP-1"}' }]);
    const res = await h.transport.send(REQ);
    expect(res.status).toBe(201);
    expect(res.attempts).toBe(3);
    expect(h.calls).toHaveLength(3);
    for (const c of h.calls) expect(c.init.headers['PayPal-Request-Id']).toBe('gv1-AAAA');
    expect(h.sleeps).toHaveLength(2);
    // random() just below 1: delay is just below min(cap, base * 2^n).
    expect(h.sleeps[0]).toBeGreaterThanOrEqual(0);
    expect(h.sleeps[0]).toBeLessThan(250);
    expect(h.sleeps[1]).toBeLessThan(500);
  });

  it('delays stay inside the full-jitter bounds for every random value', async () => {
    for (const r of [0, 0.25, 0.5, 0.999999]) {
      const h = harness([{ status: 503 }], {}, r);
      await failure(h.transport.send(REQ));
      expect(h.sleeps).toHaveLength(3);
      h.sleeps.forEach((ms, n) => {
        expect(ms).toBeGreaterThanOrEqual(0);
        expect(ms).toBeLessThanOrEqual(Math.min(4000, 250 * 2 ** n));
      });
    }
    const zero = harness([{ status: 500 }], {}, 0);
    await failure(zero.transport.send(REQ));
    expect(zero.sleeps).toEqual([0, 0, 0]);
  });

  it('caps the backoff at capMs', async () => {
    const h = harness([{ status: 502 }], { maxAttempts: 8, baseMs: 1000, capMs: 2500 });
    await failure(h.transport.send(REQ));
    expect(h.sleeps).toHaveLength(7);
    for (const ms of h.sleeps) expect(ms).toBeLessThanOrEqual(2500);
    expect(h.sleeps[6]).toBe(Math.floor(0.999999 * 2500));
  });

  it('retries network errors and reports unknown for a POST when they persist', async () => {
    const h = harness([{ throws: 'ECONNRESET' }]);
    const err = await failure(h.transport.send(REQ));
    expect(err.kind).toBe('network');
    expect(err.outcome).toBe('unknown');
    expect(h.calls).toHaveLength(4);
  });

  it('returns a non-retryable 4xx without retrying', async () => {
    const h = harness([{ status: 422, body: '{"name":"UNPROCESSABLE_ENTITY"}' }]);
    const res = await h.transport.send(REQ);
    expect(res.status).toBe(422);
    expect(res.attempts).toBe(1);
    expect(h.sleeps).toEqual([]);
  });

  it('throws the classified error when retries run out on a status', async () => {
    const h = harness([{ status: 429 }]);
    const err = await failure(h.transport.send(REQ));
    expect(err.kind).toBe('rate_limited');
    expect(err.outcome).toBe('unknown');
    expect(h.calls).toHaveLength(4);
  });

  it('respects maxAttempts', async () => {
    const h = harness([{ status: 500 }], { maxAttempts: 2 });
    await failure(h.transport.send(REQ));
    expect(h.calls).toHaveLength(2);
    expect(h.sleeps).toHaveLength(1);
  });

  it('does not add a request id header to a request without one', async () => {
    const h = harness([{ status: 200 }]);
    await h.transport.send({ method: 'GET', url: 'http://127.0.0.1/x', op: 'get' });
    expect(h.calls[0]?.init.headers['PayPal-Request-Id']).toBeUndefined();
  });
});

describe('T-PAY-011 Retry-After', () => {
  it('waits at least the Retry-After seconds', async () => {
    const h = harness([{ status: 429, headers: { 'Retry-After': '2' } }, { status: 200 }], {}, 0);
    await h.transport.send(REQ);
    expect(h.sleeps).toEqual([2000]);
  });

  it('parses an HTTP date', async () => {
    const date = new Date(1_000_000 + 5000).toUTCString();
    expect(parseRetryAfter(date, Date.parse(date) - 5000)).toBe(5000);
    const h = harness(
      [{ status: 503, headers: { 'Retry-After': date } }, { status: 200 }],
      { now: () => Date.parse(date) - 5000 },
      0,
    );
    await h.transport.send(REQ);
    expect(h.sleeps).toEqual([5000]);
  });

  it('caps Retry-After 120 at 30 s', async () => {
    const h = harness([{ status: 429, headers: { 'Retry-After': '120' } }, { status: 200 }], {}, 0);
    await h.transport.send(REQ);
    expect(h.sleeps).toEqual([30_000]);
  });

  it('keeps the computed delay when it is larger than Retry-After', async () => {
    const h = harness(
      [{ status: 429, headers: { 'Retry-After': '0' } }, { status: 200 }],
      { baseMs: 1000, capMs: 1000 },
      0.5,
    );
    await h.transport.send(REQ);
    expect(h.sleeps).toEqual([500]);
  });

  it('ignores garbage values and past dates', () => {
    expect(parseRetryAfter(undefined, 0)).toBeUndefined();
    expect(parseRetryAfter('', 0)).toBeUndefined();
    expect(parseRetryAfter('soon', 0)).toBeUndefined();
    expect(parseRetryAfter('-5', 0)).toBeUndefined();
    expect(parseRetryAfter('Thu, 01 Jan 1970 00:00:00 GMT', 10_000)).toBe(0);
  });
});

describe('attempt counter reporting', () => {
  it('logs every attempt with its number, status and request id', async () => {
    const h = harness([{ status: 500 }, { status: 200, headers: { 'PayPal-Debug-Id': 'dbg1' } }]);
    await h.transport.send({ ...REQ, auctionId: 'A1', holdId: 'H1' });
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({
      op: 'capture',
      attempt: 1,
      status: 500,
      outcome: 'unknown',
      kind: 'server_error',
      requestId: 'gv1-AAAA',
      auctionId: 'A1',
      holdId: 'H1',
    });
    expect(logs[1]).toMatchObject({ attempt: 2, status: 200, outcome: 'ok', debugId: 'dbg1' });
  });

  it('counts calls and retries in the metrics', async () => {
    const metrics = createMetrics();
    const h = harness([{ status: 500 }, { status: 500 }, { status: 200 }], { metrics });
    await h.transport.send(REQ);
    expect(metrics.counter('paypal_retries_total', { op: 'capture' })).toBe(2);
    expect(metrics.counter('paypal_calls_total', { op: 'capture', outcome: 'unknown' })).toBe(2);
    expect(metrics.counter('paypal_calls_total', { op: 'capture', outcome: 'ok' })).toBe(1);
  });

  it('never logs the Authorization header', async () => {
    const h = harness([{ status: 200 }]);
    await h.transport.send({ ...REQ, headers: { Authorization: 'Bearer abcdefghijkl' } });
    expect(JSON.stringify(logs)).not.toContain('abcdefghijkl');
  });
});
