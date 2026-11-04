import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classifyError, classifyNetworkError } from '../src/errorMap.js';
import { PayPalError } from '../src/errors.js';

interface Row {
  row: string;
  status: number;
  afterRefresh?: boolean;
  headers: Record<string, string>;
  body: string;
  expect: {
    kind: string;
    outcome: string;
    debugId?: string;
    issue?: string;
    name?: string;
  };
}

interface Garbage {
  label: string;
  status: number;
  body: string;
}

function load<T>(file: string): T {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/errors/${file}`, import.meta.url), 'utf8'),
  ) as T;
}

const rows = load<Row[]>('table.json');
const garbage = load<Garbage[]>('garbage.json');

describe('T-PAY-009 error mapping table (SPEC 4.3)', () => {
  it.each(rows.map((r) => [r.row, r] as const))('%s', (_label, r) => {
    const opts = r.afterRefresh === true ? { afterRefresh: true } : {};
    const err = classifyError(r.status, r.headers, r.body, opts);
    expect(err).toBeInstanceOf(PayPalError);
    expect(err.kind).toBe(r.expect.kind);
    expect(err.outcome).toBe(r.expect.outcome);
    expect(err.status).toBe(r.status);
    if (r.expect.debugId !== undefined) expect(err.debugId).toBe(r.expect.debugId);
    if (r.expect.issue !== undefined) expect(err.issue).toBe(r.expect.issue);
    if (r.expect.name !== undefined) expect(err.name).toBe(r.expect.name);
  });

  it('maps an unknown 422 issue to rejected, definite', () => {
    const err = classifyError(422, {}, '{"details":[{"issue":"NEVER_SEEN_BEFORE"}]}');
    expect(err.kind).toBe('rejected');
    expect(err.outcome).toBe('definite');
  });

  it('takes the debug id from the header first, then the body', () => {
    const body = '{"debug_id":"from-body"}';
    expect(classifyError(500, { 'paypal-debug-id': 'from-header' }, body).debugId).toBe(
      'from-header',
    );
    expect(classifyError(500, { 'PAYPAL-DEBUG-ID': 'upper' }, body).debugId).toBe('upper');
    expect(classifyError(500, {}, body).debugId).toBe('from-body');
    expect(classifyError(500, undefined, 'x').debugId).toBeUndefined();
  });

  it('reads headers from a Headers instance', () => {
    const h = new Headers({ 'PayPal-Debug-Id': 'hdr-1' });
    expect(classifyError(500, h, '').debugId).toBe('hdr-1');
  });

  it('treats a non-error status as an unknown outcome', () => {
    const err = classifyError(302, {}, '');
    expect(err.kind).toBe('server_error');
    expect(err.outcome).toBe('unknown');
  });

  it('is pure: the same input gives equal output', () => {
    const a = classifyError(422, { 'PayPal-Debug-Id': 'd' }, rows[9]?.body ?? '');
    const b = classifyError(422, { 'PayPal-Debug-Id': 'd' }, rows[9]?.body ?? '');
    expect({ ...a, message: a.message }).toEqual({ ...b, message: b.message });
  });
});

describe('T-PAY-018 garbage bodies', () => {
  it.each(garbage.map((g) => [g.label, g] as const))('%s surfaces as PayPalError', (_label, g) => {
    const body = g.body === 'HUGE' ? 'x'.repeat(100_000) : g.body;
    let thrown: unknown;
    let err: PayPalError | undefined;
    try {
      err = classifyError(g.status, {}, body);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeUndefined();
    expect(err).toBeInstanceOf(PayPalError);
    expect(err?.message.length ?? 0).toBeLessThanOrEqual(210);
    expect(err?.message).not.toBe('');
    expect(err?.outcome).toBe(g.status >= 500 || g.status === 429 ? 'unknown' : 'definite');
  });

  it('classifies network failures as unknown', () => {
    const post = classifyNetworkError(new Error('socket hang up'), 'POST');
    const get = classifyNetworkError('timeout', 'get');
    expect(post).toBeInstanceOf(PayPalError);
    expect(post.kind).toBe('network');
    expect(post.outcome).toBe('unknown');
    expect(get.kind).toBe('network');
    expect(classifyNetworkError(undefined, 'GET').message).toBe('read failed');
  });
});
