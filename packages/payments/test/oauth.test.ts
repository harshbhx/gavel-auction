import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PayPalError } from '../src/errors.js';
import { EXPIRY_MARGIN_MS, TokenManager } from '../src/oauth.js';
import { clearRegisteredSecrets, setLogSink } from '../src/log.js';
import { Transport, type FetchLike, type TransportInit } from '../src/transport.js';

const BASE = 'http://127.0.0.1:4010';

interface Seen {
  url: string;
  init: TransportInit;
}

interface Server {
  tokenCalls: number;
  businessCalls: Seen[];
  /** Number of upcoming business calls answered with 401. */
  reject401: number;
  expiresIn: number;
  tokenStatus: number;
  tokenBody: string | undefined;
  /** Tokens the server accepts. */
  valid: Set<string>;
  fetch: FetchLike;
}

function makeServer(): Server {
  const s: Server = {
    tokenCalls: 0,
    businessCalls: [],
    reject401: 0,
    expiresIn: 3600,
    tokenStatus: 200,
    tokenBody: undefined,
    valid: new Set(),
    fetch: async () => {
      throw new Error('unset');
    },
  };
  s.fetch = async (url, init) => {
    const respond = (status: number, body: string) => {
      const res = new Response(body, { status });
      return { status: res.status, headers: res.headers, text: () => res.text() };
    };
    // Yield so that concurrent callers really overlap.
    await new Promise<void>((r) => setImmediate(r));
    if (url.endsWith('/v1/oauth2/token')) {
      s.tokenCalls += 1;
      if (s.tokenStatus !== 200) return respond(s.tokenStatus, '{"error":"invalid_client"}');
      if (s.tokenBody !== undefined) return respond(200, s.tokenBody);
      const token = `tok-${s.tokenCalls}`;
      s.valid.add(token);
      return respond(200, JSON.stringify({ access_token: token, expires_in: s.expiresIn }));
    }
    s.businessCalls.push({ url, init });
    const auth = init.headers['Authorization'] ?? '';
    if (s.reject401 > 0) {
      s.reject401 -= 1;
      return respond(401, '{"name":"AUTHENTICATION_FAILURE","message":"expired"}');
    }
    if (!s.valid.has(auth.replace('Bearer ', ''))) return respond(401, '{"name":"UNAUTHORIZED"}');
    return respond(200, '{"ok":true}');
  };
  return s;
}

let restoreSink: ((line: string) => void) | undefined;
beforeEach(() => {
  restoreSink = setLogSink(() => undefined);
});
afterEach(() => {
  if (restoreSink !== undefined) setLogSink(restoreSink);
  clearRegisteredSecrets();
});

function make(server: Server, clock: { t: number }) {
  const transport = new Transport({
    fetch: server.fetch,
    sleep: async () => undefined,
    random: () => 0,
    now: () => clock.t,
    maxAttempts: 1,
  });
  return new TokenManager({
    transport,
    baseUrl: `${BASE}/`,
    clientId: 'client-id',
    clientSecret: 'client-secret-value',
    now: () => clock.t,
  });
}

const CAPTURE = {
  method: 'POST',
  path: '/v2/payments/authorizations/AUTH-1/capture',
  op: 'capture',
  requestId: 'gv1-AAAA',
  body: '{}',
};

describe('token manager', () => {
  it('requests a token with HTTP Basic and the client_credentials grant', async () => {
    const server = makeServer();
    const seen: TransportInit[] = [];
    const inner = server.fetch;
    server.fetch = async (url, init) => {
      if (url.endsWith('/token')) seen.push(init);
      return inner(url, init);
    };
    const m = make(server, { t: 0 });
    await m.getToken();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.method).toBe('POST');
    expect(seen[0]?.body).toBe('grant_type=client_credentials');
    const basic = Buffer.from('client-id:client-secret-value').toString('base64');
    expect(seen[0]?.headers['Authorization']).toBe(`Basic ${basic}`);
  });

  it('caches the token until expires_in minus the 60 s margin', async () => {
    const server = makeServer();
    server.expiresIn = 300;
    const clock = { t: 1_000 };
    const m = make(server, clock);
    expect(await m.getToken()).toBe('tok-1');
    clock.t += 300_000 - EXPIRY_MARGIN_MS - 1;
    expect(await m.getToken()).toBe('tok-1');
    expect(server.tokenCalls).toBe(1);
    clock.t += 1;
    expect(await m.getToken()).toBe('tok-2');
    expect(server.tokenCalls).toBe(2);
  });

  it('T-PAY-013: 20 concurrent calls with an expired token make exactly one token request', async () => {
    const server = makeServer();
    const clock = { t: 0 };
    const m = make(server, clock);
    await m.getToken();
    clock.t += 10_000_000;
    server.tokenCalls = 0;
    const results = await Promise.all(Array.from({ length: 20 }, () => m.send(CAPTURE)));
    expect(server.tokenCalls).toBe(1);
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(new Set(server.businessCalls.map((c) => c.init.headers['Authorization'])).size).toBe(1);
  });

  it('shares one request for concurrent first calls', async () => {
    const server = makeServer();
    const m = make(server, { t: 0 });
    const tokens = await Promise.all(Array.from({ length: 20 }, () => m.getToken()));
    expect(server.tokenCalls).toBe(1);
    expect(new Set(tokens).size).toBe(1);
  });

  it('T-PAY-014: a 401 refreshes the token once and replays the call', async () => {
    const server = makeServer();
    const m = make(server, { t: 0 });
    await m.getToken();
    server.reject401 = 1;
    const res = await m.send(CAPTURE);
    expect(res.status).toBe(200);
    expect(server.tokenCalls).toBe(2);
    expect(server.businessCalls).toHaveLength(2);
    expect(server.businessCalls[0]?.init.headers['Authorization']).toBe('Bearer tok-1');
    expect(server.businessCalls[1]?.init.headers['Authorization']).toBe('Bearer tok-2');
    for (const c of server.businessCalls) {
      expect(c.init.headers['PayPal-Request-Id']).toBe('gv1-AAAA');
      expect(c.url).toBe(`${BASE}${CAPTURE.path}`);
    }
  });

  it('T-PAY-014: a second 401 gives auth_failed and is not replayed again', async () => {
    const server = makeServer();
    const m = make(server, { t: 0 });
    server.reject401 = 2;
    const err = await m.send(CAPTURE).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(PayPalError);
    expect((err as PayPalError).kind).toBe('auth_failed');
    expect((err as PayPalError).outcome).toBe('definite');
    expect(server.businessCalls).toHaveLength(2);
    expect(server.tokenCalls).toBe(2);
  });

  it('concurrent 401s share one refresh', async () => {
    const server = makeServer();
    const m = make(server, { t: 0 });
    await m.getToken();
    // The server forgets tok-1: every call with it is answered 401.
    server.valid.clear();
    const results = await Promise.all(Array.from({ length: 10 }, () => m.send(CAPTURE)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(server.tokenCalls).toBe(2);
  });

  it('does not replay non-401 failures', async () => {
    const server = makeServer();
    const inner = server.fetch;
    server.fetch = async (url, init) => {
      if (url.endsWith('/token')) return inner(url, init);
      const res = new Response('{"name":"UNPROCESSABLE_ENTITY"}', { status: 422 });
      return { status: 422, headers: res.headers, text: () => res.text() };
    };
    const m = make(server, { t: 0 });
    const res = await m.send(CAPTURE);
    expect(res.status).toBe(422);
    expect(server.tokenCalls).toBe(1);
  });

  it('bad credentials end as auth_failed and are not cached', async () => {
    const server = makeServer();
    server.tokenStatus = 401;
    const m = make(server, { t: 0 });
    const err = await m.getToken().then(
      () => undefined,
      (e: unknown) => e,
    );
    expect((err as PayPalError).kind).toBe('auth_failed');
    server.tokenStatus = 200;
    expect(await m.getToken()).toBe('tok-2');
  });

  it('a token response without access_token is auth_failed', async () => {
    const server = makeServer();
    server.tokenBody = '{"expires_in":10}';
    const m = make(server, { t: 0 });
    const err = await m.getToken().then(
      () => undefined,
      (e: unknown) => e,
    );
    expect((err as PayPalError).kind).toBe('auth_failed');
  });

  it('never puts the token or the client secret in an error message', async () => {
    const server = makeServer();
    const m = make(server, { t: 0 });
    server.reject401 = 2;
    const err = (await m.send(CAPTURE).then(
      () => undefined,
      (e: unknown) => e,
    )) as PayPalError;
    expect(err.message).not.toContain('tok-');
    expect(err.message).not.toContain('client-secret-value');
  });
});
