import { ERROR_CODES, ERROR_TABLE, GavelError, ManualClock, SeqIds } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { secretSetFromConfig } from '../src/auth/rotation';
import { createHttpApp, json, MAX_BODY_BYTES, type HttpDeps } from '../src/http/app';
import { MemoryStore } from '../src/store/memory-store';

const ORIGIN = 'https://app.example.test';

function setup(): ReturnType<typeof createHttpApp> {
  const clock = new ManualClock(1_789_000_000_000);
  const deps: HttpDeps = {
    service: {
      createAuction: () => Promise.reject(new Error('unused')),
      room: () => Promise.reject(new Error('unused')),
    },
    store: new MemoryStore(() => clock.now()),
    clock,
    ids: new SeqIds(),
    secrets: secretSetFromConfig({ TOKEN_SECRET: 'fake-secret-fake-secret-fake-0000' }),
    adminKey: 'fake-admin-key',
    publicUrl: 'https://gavel.example.test',
    corsOrigins: [ORIGIN],
  };
  return createHttpApp(deps, [
    (app) => {
      app.get('/t/err/:code', (c) => {
        throw new GavelError(c.params.code as (typeof ERROR_CODES)[number], 'boom');
      });
      app.get('/t/crash', () => {
        throw new Error('secret internals');
      });
      app.post('/t/echo', async (c) => json(200, { body: await c.body() }));
    },
  ]);
}

const post = (path: string, body: string, type: string | null) =>
  new Request(`http://h.test${path}`, {
    method: 'POST',
    body,
    headers: type === null ? {} : { 'content-type': type },
  });

describe('http app errors and request ids (T-RT-072)', () => {
  it('maps every ErrorCode to its table status with {code,message} and x-request-id', async () => {
    const app = setup();
    for (const code of ERROR_CODES) {
      const res = await app.fetch(new Request(`http://h.test/t/err/${code}`));
      const expected = code === 'internal' ? 500 : ERROR_TABLE[code].status;
      expect(res.status).toBe(expected);
      expect(res.headers.get('x-request-id')).toMatch(/^[A-Za-z0-9_-]+$/);
      const body = (await res.json()) as { code: string; message: string };
      expect(body.code).toBe(code);
      expect(typeof body.message).toBe('string');
    }
  });

  it('answers an unknown route with 404 and {code,message}', async () => {
    const res = await setup().fetch(new Request('http://h.test/nope'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ code: 'not_found', message: 'no such route' });
    expect(res.headers.get('x-request-id')).not.toBeNull();
  });

  it('hides internals of an unexpected failure', async () => {
    const res = await setup().fetch(new Request('http://h.test/t/crash'));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ code: 'internal', message: 'internal error' });
  });

  it('echoes a well-formed request id and replaces a malformed one', async () => {
    const app = setup();
    const ok = await app.fetch(
      new Request('http://h.test/nope', { headers: { 'x-request-id': 'req-123' } }),
    );
    expect(ok.headers.get('x-request-id')).toBe('req-123');
    const bad = await app.fetch(
      new Request('http://h.test/nope', { headers: { 'x-request-id': 'bad id!' } }),
    );
    expect(bad.headers.get('x-request-id')).not.toBe('bad id!');
  });
});

describe('body rules and CORS (T-RT-077)', () => {
  it('rejects text/plain with 415', async () => {
    const res = await setup().fetch(post('/t/echo', '{}', 'text/plain'));
    expect(res.status).toBe(415);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'bad_message' });
  });

  it('accepts a body of exactly the limit and rejects 65537 bytes with 413', async () => {
    const app = setup();
    const pad = (n: number): string => `{"a":"${'x'.repeat(n - 8)}"}`;
    const edge = await app.fetch(post('/t/echo', pad(MAX_BODY_BYTES), 'application/json'));
    expect(edge.status).toBe(200);
    const over = await app.fetch(post('/t/echo', pad(MAX_BODY_BYTES + 1), 'application/json'));
    expect(over.status).toBe(413);
  });

  it('rejects a body larger than the limit even without a content-length', async () => {
    const big = new Request('http://h.test/t/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: new ReadableStream<Uint8Array>({
        start(ctl) {
          ctl.enqueue(new TextEncoder().encode(`{"a":"${'x'.repeat(70_000)}"}`));
          ctl.close();
        },
      }),
      duplex: 'half',
    } as RequestInit);
    expect((await setup().fetch(big)).status).toBe(413);
  });

  it('rejects malformed JSON with 400', async () => {
    const res = await setup().fetch(post('/t/echo', '{nope', 'application/json'));
    expect(res.status).toBe(400);
  });

  it('allows a preflight only for the allowlist', async () => {
    const app = setup();
    const pre = (origin: string) =>
      app.fetch(new Request('http://h.test/t/echo', { method: 'OPTIONS', headers: { origin } }));
    const allowed = await pre(ORIGIN);
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    const denied = await pre('https://evil.example.test');
    expect(denied.status).toBe(403);
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();
    expect(denied.headers.get('x-request-id')).not.toBeNull();
  });

  it('adds CORS headers to normal responses only for allowed origins', async () => {
    const app = setup();
    const a = await app.fetch(new Request('http://h.test/nope', { headers: { origin: ORIGIN } }));
    expect(a.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    const b = await app.fetch(
      new Request('http://h.test/nope', { headers: { origin: 'https://evil.example.test' } }),
    );
    expect(b.headers.get('access-control-allow-origin')).toBeNull();
  });
});
