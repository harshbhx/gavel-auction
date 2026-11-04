import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PayPalError } from '../src/errors.js';
import { FakePayPalServer } from '../src/fake/server.js';
import { assertFakeInvariants } from '../src/fake/invariants.js';
import { TokenManager } from '../src/oauth.js';
import { PaymentsApiClient } from '../src/paymentsApi.js';
import { Transport, type FetchLike } from '../src/transport.js';

interface Seen {
  method: string;
  url: string;
  body: string | undefined;
  headers: Record<string, string>;
}

let server: FakePayPalServer;
let seen: Seen[];
let api: PaymentsApiClient;

const noSleep = async (): Promise<void> => undefined;

beforeEach(async () => {
  server = new FakePayPalServer({ timers: { sleep: noSleep } });
  await server.start();
  seen = [];
  const recording: FetchLike = async (url, init) => {
    seen.push({ method: init.method, url, body: init.body, headers: init.headers });
    return fetch(url, init);
  };
  const transport = new Transport({ fetch: recording, sleep: noSleep });
  const auth = new TokenManager({
    transport,
    baseUrl: server.url,
    clientId: 'fake-client',
    clientSecret: 'fake-secret-value',
  });
  api = new PaymentsApiClient({ auth });
});

afterEach(async () => {
  assertFakeInvariants(server.core);
  await server.stop();
});

function newAuth(cents = 10000): string {
  return server.core.createAuthorization('buyer', cents).id;
}

function bodyOf(suffix: string): Record<string, unknown> {
  const hit = [...seen].reverse().find((s) => s.url.endsWith(suffix));
  if (hit?.body === undefined) throw new Error(`no request body seen for ${suffix}`);
  return JSON.parse(hit.body) as Record<string, unknown>;
}

async function failure(p: Promise<unknown>): Promise<PayPalError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof PayPalError) return e;
    throw e;
  }
  throw new Error('expected the call to fail');
}

describe('T-PAY-017 capture', () => {
  it('sends final_capture, a decimal amount and invoice_id', async () => {
    const authId = newAuth(10000);
    const c = await api.capture(authId, {
      amountCents: 8905,
      finalCapture: true,
      invoiceId: 'gavel-auc1-hold1',
      requestId: 'req-cap-1',
    });
    expect(c.captureId).not.toBe('');
    expect(c.amountCents).toBe(8905);

    expect(bodyOf('/capture')).toEqual({
      amount: { currency_code: 'USD', value: '89.05' },
      final_capture: true,
      invoice_id: 'gavel-auc1-hold1',
    });
    const post = seen.find((s) => s.url.endsWith('/capture'));
    expect(post?.headers['PayPal-Request-Id']).toBe('req-cap-1');
  });

  it('sends final_capture false when asked', async () => {
    const authId = newAuth(10000);
    await api.capture(authId, {
      amountCents: 2000,
      finalCapture: false,
      invoiceId: 'inv',
      requestId: 'req-cap-2',
    });
    expect(bodyOf('/capture')['final_capture']).toBe(false);
  });

  it('a replay with the same request id captures once', async () => {
    const authId = newAuth(10000);
    const i = { amountCents: 5000, finalCapture: true, invoiceId: 'inv', requestId: 'req-same' };
    const a = await api.capture(authId, i);
    const b = await api.capture(authId, i);
    expect(b.captureId).toBe(a.captureId);
    expect(server.core.inspect(authId).capturedCents).toBe(5000);
  });

  it('a decline is a definite failure', async () => {
    const authId = newAuth(10000);
    server.faults.add({ kind: 'capture_declined', op: 'capture' });
    const err = await failure(
      api.capture(authId, {
        amountCents: 5000,
        finalCapture: true,
        invoiceId: 'inv',
        requestId: 'req-dec',
      }),
    );
    expect(err.kind).toBe('declined');
    expect(err.outcome).toBe('definite');
  });

  it('a second final capture is already_captured', async () => {
    const authId = newAuth(10000);
    await api.capture(authId, {
      amountCents: 5000,
      finalCapture: true,
      invoiceId: 'inv',
      requestId: 'req-1',
    });
    const err = await failure(
      api.capture(authId, {
        amountCents: 100,
        finalCapture: true,
        invoiceId: 'inv',
        requestId: 'req-2',
      }),
    );
    expect(err.kind).toBe('already_captured');
  });
});

describe('getAuthorization', () => {
  it('returns status and amount', async () => {
    const authId = newAuth(7500);
    expect(await api.getAuthorization(authId)).toEqual({
      authId,
      status: 'CREATED',
      amountCents: 7500,
    });
  });

  it('maps an unknown id to not_found', async () => {
    const err = await failure(api.getAuthorization('NO-SUCH'));
    expect(err.kind).toBe('not_found');
  });
});

describe('voidAuthorization', () => {
  it('voids once and reports a second void as already_voided', async () => {
    const authId = newAuth();
    await api.voidAuthorization(authId, 'req-void-1');
    expect((await api.getAuthorization(authId)).status).toBe('VOIDED');
    const err = await failure(api.voidAuthorization(authId, 'req-void-2'));
    expect(err.kind).toBe('already_voided');
    expect(err.outcome).toBe('definite');
    expect(server.core.inspect(authId).voidEffects).toBe(1);
  });

  it('sends the request id', async () => {
    const authId = newAuth();
    await api.voidAuthorization(authId, 'req-void-3');
    const post = seen.find((s) => s.url.endsWith('/void'));
    expect(post?.headers['PayPal-Request-Id']).toBe('req-void-3');
  });
});

describe('reauthorize', () => {
  it('is only sent by an explicit call', async () => {
    const authId = newAuth();
    await api.getAuthorization(authId);
    await api.voidAuthorization(authId, 'req-v');
    expect(seen.some((s) => s.url.endsWith('/reauthorize'))).toBe(false);
  });

  it('posts the new amount after the honor period', async () => {
    const authId = newAuth(10000);
    server.core.clock.advance(4 * 86_400_000);
    const r = await api.reauthorize(authId, { amountCents: 9000, requestId: 'req-re-1' });
    expect(r.amountCents).toBe(9000);
    expect(bodyOf('/reauthorize')).toEqual({ amount: { currency_code: 'USD', value: '90.00' } });
  });

  it('a refusal inside the honor period is a definite failure', async () => {
    const authId = newAuth(10000);
    const err = await failure(
      api.reauthorize(authId, { amountCents: 9000, requestId: 'req-re-2' }),
    );
    expect(err.outcome).toBe('definite');
  });
});

describe('capture result checks', () => {
  function stub(status: number, body: unknown): PaymentsApiClient {
    return new PaymentsApiClient({
      auth: {
        send: async () => ({
          status,
          headers: {},
          text: JSON.stringify(body),
          attempts: 1,
        }),
      },
    });
  }
  const input = { amountCents: 1000, finalCapture: true, invoiceId: 'inv', requestId: 'r' };
  const amt = (value: string): { currency_code: string; value: string } => ({
    currency_code: 'USD',
    value,
  });

  it('accepts a COMPLETED capture for the requested amount', async () => {
    const c = await stub(201, { id: 'C1', status: 'COMPLETED', amount: amt('10.00') }).capture(
      'A',
      input,
    );
    expect(c).toEqual({ captureId: 'C1', amountCents: 1000 });
  });

  it('a PENDING capture is an unknown outcome, not a charge', async () => {
    const err = await failure(
      stub(201, { id: 'C1', status: 'PENDING', amount: amt('10.00') }).capture('A', input),
    );
    expect(err.outcome).toBe('unknown');
  });

  it('a DECLINED capture is a definite failure', async () => {
    const err = await failure(
      stub(201, { id: 'C1', status: 'DECLINED', amount: amt('10.00') }).capture('A', input),
    );
    expect(err.kind).toBe('declined');
    expect(err.outcome).toBe('definite');
  });

  it('a different reported amount is an unknown outcome', async () => {
    const err = await failure(
      stub(201, { id: 'C1', status: 'COMPLETED', amount: amt('4.00') }).capture('A', input),
    );
    expect(err.outcome).toBe('unknown');
  });

  it('a missing amount is an unknown outcome', async () => {
    const err = await failure(stub(201, { id: 'C1', status: 'COMPLETED' }).capture('A', input));
    expect(err.outcome).toBe('unknown');
  });
});
