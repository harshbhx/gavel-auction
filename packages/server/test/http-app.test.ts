import { ERROR_CODES, ERROR_TABLE, GavelError, ManualClock, SeqIds } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { createLogger, MemorySink } from '../src/log/logger';
import { secretSetFromConfig } from '../src/auth/rotation';
import { createHttpApp, json, MAX_BODY_BYTES, type HttpDeps, type Mount } from '../src/http/app';
import { MemoryStore } from '../src/store/memory-store';

const ORIGIN = 'https://app.example.test';

function baseDeps(log?: HttpDeps['log']): HttpDeps {
  const clock = new ManualClock(1_789_000_000_000);
  return {
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
    ...(log !== undefined ? { log } : {}),
  };
}

function setup(log?: HttpDeps['log']): ReturnType<typeof createHttpApp> {
  return createHttpApp(baseDeps(log), [
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

describe('http app refuses writes from unknown origins (#2061)', () => {
  const EVIL = 'https://evil.example.test';
  const write = (method: string, origin: string | null) =>
    new Request('http://h.test/t/echo', {
      method,
      ...(origin !== null ? { headers: { origin } } : {}),
    });

  it('answers 403 before the handler runs for a disallowed Origin, with no body needed', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await setup().fetch(write(method, EVIL));
      expect(res.status).toBe(403);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe('forbidden');
    }
    const calls: string[] = [];
    const app = createHttpApp({ ...baseDeps(), corsOrigins: [ORIGIN] }, [
      (a) =>
        a.post('/t/side', () => {
          calls.push('ran');
          return json(200, {});
        }),
    ]);
    const res = await app.fetch(
      new Request('http://h.test/t/side', { method: 'POST', headers: { origin: EVIL } }),
    );
    expect(res.status).toBe(403);
    expect(calls).toEqual([]);
  });

  it('treats the literal null origin as unknown', async () => {
    const res = await setup().fetch(write('POST', 'null'));
    expect(res.status).toBe(403);
  });

  it('lets a write from an allowed origin through', async () => {
    const res = await setup().fetch(write('POST', ORIGIN));
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
  });

  it('lets the web origin and the API own origin write', async () => {
    const app = createHttpApp(
      { ...baseDeps(), corsOrigins: [], webOrigin: 'https://web.example.test' },
      [(a) => a.post('/t/echo', () => json(200, {}))],
    );
    expect((await app.fetch(write('POST', 'https://web.example.test'))).status).toBe(200);
    expect((await app.fetch(write('POST', 'https://gavel.example.test'))).status).toBe(200);
    expect((await app.fetch(write('POST', EVIL))).status).toBe(403);
  });

  it('lets a write with no Origin through (curl, webhooks, scripts)', async () => {
    const res = await setup().fetch(write('POST', null));
    expect(res.status).toBe(200);
  });

  it('keeps GET and a webhook-style raw POST without Origin unchanged', async () => {
    const app = createHttpApp(baseDeps(), [
      (a) => {
        a.get('/t/read', () => json(200, { ok: true }));
        a.post('/webhooks/paypal', () => json(200, { received: true }));
        a.get('/healthz', () => json(200, { ok: true }));
      },
    ]);
    const read = await app.fetch(
      new Request('http://h.test/t/read', { headers: { origin: EVIL } }),
    );
    expect(read.status).toBe(200);
    expect(read.headers.get('access-control-allow-origin')).toBeNull();
    const hook = await app.fetch(
      new Request('http://h.test/webhooks/paypal', { method: 'POST', body: '{}' }),
    );
    expect(hook.status).toBe(200);
    expect((await app.fetch(new Request('http://h.test/healthz'))).status).toBe(200);
  });

  it('leaves the preflight as it was', async () => {
    const app = setup();
    const pre = (origin: string) =>
      app.fetch(new Request('http://h.test/t/echo', { method: 'OPTIONS', headers: { origin } }));
    expect((await pre(ORIGIN)).status).toBe(204);
    expect((await pre(EVIL)).status).toBe(403);
  });
});

describe('http app security headers and CORS (T-QA-075, T-QA-076)', () => {
  it('adds the baseline headers to every response, including errors', async () => {
    const app = setup();
    for (const path of ['/t/echo', '/t/crash', '/nope']) {
      const res = await app.fetch(new Request(`http://h.test${path}`));
      expect(res.headers.get('content-security-policy')).toBeTruthy();
      expect(res.headers.get('strict-transport-security')).toMatch(/max-age=\d+/);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    }
  });

  it('reflects only configured origins', async () => {
    const app = setup();
    const ok = await app.fetch(new Request('http://h.test/nope', { headers: { origin: ORIGIN } }));
    expect(ok.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    const evil = await app.fetch(
      new Request('http://h.test/nope', { headers: { origin: 'https://evil.example' } }),
    );
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('http request log context (R-RT-133, T-RT-092)', () => {
  it('logs one line per request stamped with the request id the response carries', async () => {
    const sink = new MemorySink();
    const app = setup(
      createLogger({ clock: new ManualClock(1_789_000_000_000), sink: sink.write }),
    );
    const res = await app.fetch(
      new Request('http://h.test/t/err/not_found', { headers: { 'x-request-id': 'req-77' } }),
    );
    expect(res.headers.get('x-request-id')).toBe('req-77');
    const line = sink.records().find((r) => r.msg === 'http request');
    expect(line?.context).toMatchObject({
      reqId: 'req-77',
      method: 'GET',
      path: '/t/err/not_found',
      status: 404,
    });
  });
});

describe('one origin allow-list for writes and CORS headers (#2233)', () => {
  const WEB = 'https://web.example.test';
  const route: Mount = (a) => {
    a.post('/t/echo', async (c) => json(200, { body: await c.body() }));
  };
  const make = (over: Partial<HttpDeps>) => createHttpApp({ ...baseDeps(), ...over }, [route]);
  const send = (origin: string, method = 'POST') =>
    new Request('http://h.test/t/echo', { method, headers: { origin } });

  it('WEB_ORIGIN passes the write check and gets the allow-origin header and preflight', async () => {
    const app = make({ webOrigin: WEB });
    const res = await app.fetch(send(WEB));
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(WEB);
    expect((await app.fetch(send(WEB, 'OPTIONS'))).status).toBe(204);
  });

  it('the API own origin gets the same treatment', async () => {
    const app = make({});
    const res = await app.fetch(send('https://gavel.example.test'));
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://gavel.example.test');
  });

  it('a configured entry with a trailing slash or upper case still matches the browser Origin', async () => {
    const app = make({ corsOrigins: ['HTTPS://App.Example.Test/'] });
    const res = await app.fetch(send(ORIGIN));
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
  });

  it('keeps refusing a null or foreign origin with 403 (#2168)', async () => {
    const app = make({ webOrigin: WEB });
    for (const origin of ['null', 'https://evil.example.test', `${WEB}.evil.test`]) {
      const res = await app.fetch(send(origin));
      expect(res.status, origin).toBe(403);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    }
  });

  it('an unusable configured entry allows nothing', async () => {
    const app = make({ corsOrigins: ['*', 'https://x.example.test/path'] });
    expect((await app.fetch(send('*'))).status).toBe(403);
    expect((await app.fetch(send('https://x.example.test'))).status).toBe(403);
  });
});
