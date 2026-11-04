import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PayPalError } from '../src/errors.js';
import { clearRegisteredSecrets, setLogSink } from '../src/log.js';
import { DEFAULT_TIMEOUT_MS, Transport, type FetchLike } from '../src/transport.js';

let restoreSink: ((line: string) => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  restoreSink = setLogSink(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  if (restoreSink !== undefined) setLogSink(restoreSink);
  clearRegisteredSecrets();
});

/** A fetch that answers after `delayMs` of fake time, or rejects when aborted first. */
function slow(delayMs: number, seen: { signals: AbortSignal[] }): FetchLike {
  return (_url, init) =>
    new Promise((resolve, reject) => {
      const signal = init.signal;
      if (signal === undefined) {
        reject(new Error('no signal passed to fetch'));
        return;
      }
      seen.signals.push(signal);
      const timer = setTimeout(() => {
        resolve({
          status: 200,
          headers: new Headers(),
          text: async () => '{}',
        });
      }, delayMs);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        const e = new Error('The operation was aborted');
        e.name = 'AbortError';
        reject(e);
      });
    });
}

function make(delayMs: number, timeoutMs?: number) {
  const seen = { signals: [] as AbortSignal[] };
  const transport = new Transport({
    fetch: slow(delayMs, seen),
    sleep: async () => undefined,
    random: () => 0,
    now: () => 0,
    maxAttempts: 1,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });
  return { transport, seen };
}

async function settle(p: Promise<unknown>, advanceMs: number): Promise<PayPalError> {
  const outcome = p.then(
    () => undefined,
    (e: unknown) => e,
  );
  await vi.advanceTimersByTimeAsync(advanceMs);
  const e = await outcome;
  expect(e).toBeInstanceOf(PayPalError);
  return e as PayPalError;
}

describe('transport timeout (T-PAY-012)', () => {
  it('defaults to 10 seconds', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(10_000);
  });

  it('slow(15000) with the default timeout: POST is a network error with unknown outcome', async () => {
    const { transport, seen } = make(15_000);
    const err = await settle(
      transport.send({ method: 'POST', url: 'http://127.0.0.1/x', op: 'capture', body: '{}' }),
      10_000,
    );
    expect(err.kind).toBe('network');
    expect(err.outcome).toBe('unknown');
    expect(err.status).toBe(0);
    expect(err.message).toContain('request outcome unknown');
    expect(err.message).toContain('timed out after 10000 ms');
    expect(seen.signals[0]?.aborted).toBe(true);
  });

  it('slow(15000) with the default timeout: GET is a transient read failure', async () => {
    const { transport } = make(15_000);
    const err = await settle(
      transport.send({ method: 'GET', url: 'http://127.0.0.1/x', op: 'get' }),
      10_000,
    );
    expect(err.kind).toBe('network');
    expect(err.outcome).toBe('unknown');
    expect(err.message).toContain('read failed');
  });

  it('does not abort before the timeout elapses', async () => {
    const { transport, seen } = make(9_000);
    const p = transport.send({ method: 'GET', url: 'http://127.0.0.1/x', op: 'get' });
    await vi.advanceTimersByTimeAsync(9_000);
    const res = await p;
    expect(res.status).toBe(200);
    expect(seen.signals[0]?.aborted).toBe(false);
  });

  it('the timeout is injectable', async () => {
    const { transport } = make(500, 100);
    const err = await settle(
      transport.send({ method: 'POST', url: 'http://127.0.0.1/x', op: 'void', body: '{}' }),
      100,
    );
    expect(err.kind).toBe('network');
    expect(err.message).toContain('timed out after 100 ms');
  });

  it('rejects a non-positive timeout', () => {
    expect(() => new Transport({ timeoutMs: 0 })).toThrow(RangeError);
    expect(() => new Transport({ timeoutMs: Number.NaN })).toThrow(RangeError);
  });

  it('a timeout is retried like any network error, with the same request id', async () => {
    const ids: Array<string | undefined> = [];
    let n = 0;
    const fetch: FetchLike = (_url, init) =>
      new Promise((resolve, reject) => {
        ids.push(init.headers['PayPal-Request-Id']);
        n += 1;
        if (n === 1) {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          return;
        }
        resolve({ status: 200, headers: new Headers(), text: async () => '{}' });
      });
    const transport = new Transport({
      fetch,
      sleep: async () => undefined,
      random: () => 0,
      now: () => 0,
      timeoutMs: 50,
    });
    const p = transport.send({
      method: 'POST',
      url: 'http://127.0.0.1/x',
      op: 'capture',
      requestId: 'gv1-AAAA',
      body: '{}',
    });
    await vi.advanceTimersByTimeAsync(50);
    const res = await p;
    expect(res.attempts).toBe(2);
    expect(ids).toEqual(['gv1-AAAA', 'gv1-AAAA']);
  });
});
