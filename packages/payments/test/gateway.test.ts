import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PayPalError } from '../src/errors.js';
import { FakeClock, FakePayPalCore } from '../src/fake/core.js';
import { FakeGateway } from '../src/fake/gateway.js';
import { assertFakeInvariants } from '../src/fake/invariants.js';
import { FakePayPalServer } from '../src/fake/server.js';
import { PayPalGateway, capturesOf, type GatewayAuth } from '../src/gateway.js';
import { clearRegisteredSecrets, setLogSink } from '../src/log.js';
import { createMetrics } from '../src/metrics.js';
import { TokenManager } from '../src/oauth.js';
import type { KillSwitch, PaymentsGateway } from '../src/ports.js';
import { Transport, type TransportResult } from '../src/transport.js';

const noSleep = async (): Promise<void> => undefined;
const START_MS = 1_800_000_000_000;

interface Rig {
  gw: PaymentsGateway;
  core: FakePayPalCore;
  declineNextCapture(): void;
  close(): Promise<void>;
}

async function fakeRig(): Promise<Rig> {
  const core = new FakePayPalCore({ clock: new FakeClock(START_MS) });
  return {
    gw: new FakeGateway(core),
    core,
    declineNextCapture: () => core.inject('capture', 'capture_declined'),
    close: async () => undefined,
  };
}

async function httpRig(extra: { killSwitch?: KillSwitch } = {}): Promise<Rig> {
  const server = new FakePayPalServer({
    core: { clock: new FakeClock(START_MS) },
    timers: { sleep: noSleep },
  });
  await server.start();
  const transport = new Transport({ sleep: noSleep });
  const auth = new TokenManager({
    transport,
    baseUrl: server.url,
    clientId: 'fake-client',
    clientSecret: 'fake-secret-value',
  });
  const gw = new PayPalGateway({
    auth,
    fake: true,
    clock: { nowMs: () => server.core.clock.nowMs() },
    ...extra,
  });
  return {
    gw,
    core: server.core,
    declineNextCapture: () => server.faults.add({ kind: 'capture_declined', op: 'capture' }),
    close: () => server.stop(),
  };
}

type Step =
  | { ok: unknown }
  | { error: { kind: string; outcome: string; status: number; issue?: string } };

async function attempt(fn: () => Promise<unknown>): Promise<Step> {
  try {
    return { ok: (await fn()) ?? null };
  } catch (e) {
    if (!(e instanceof PayPalError)) throw e;
    const error: { kind: string; outcome: string; status: number; issue?: string } = {
      kind: e.kind,
      outcome: e.outcome,
      status: e.status,
    };
    if (e.issue !== undefined) error.issue = e.issue;
    return { error };
  }
}

/** One scenario through the port. Everything it returns must be identical for every gateway. */
async function scenario(rig: Rig): Promise<Step[]> {
  const { gw, core } = rig;
  const trace: Step[] = [];
  const log = async (fn: () => Promise<unknown>): Promise<Step> => {
    const s = await attempt(fn);
    trace.push(s);
    return s;
  };

  const created = await gw.createOrder({
    holdId: 'h1',
    ceilingCents: 10000,
    description: 'hold',
    requestId: 'r-order-1',
  });
  trace.push({ ok: created });
  await log(() => gw.getOrder(created.orderId));
  await log(() => gw.authorizeOrder(created.orderId, 'r-auth-unapproved'));
  core.approveOrder(created.orderId);
  const authorized = await gw.authorizeOrder(created.orderId, 'r-auth-1');
  trace.push({ ok: authorized });
  await log(() => gw.getOrder(created.orderId));
  const ref = { holdId: 'h1', authId: authorized.authId, orderId: created.orderId };
  await log(() => gw.getHoldTruth(ref));

  await log(() =>
    gw.capture(authorized.authId, {
      amountCents: 4000,
      finalCapture: false,
      invoiceId: 'inv-1',
      requestId: 'r-cap-1',
    }),
  );
  await log(() => gw.getHoldTruth(ref));
  rig.declineNextCapture();
  await log(() =>
    gw.capture(authorized.authId, {
      amountCents: 3000,
      finalCapture: true,
      invoiceId: 'inv-1',
      requestId: 'r-cap-declined',
    }),
  );
  const finalCap = {
    amountCents: 3000,
    finalCapture: true,
    invoiceId: 'inv-1',
    requestId: 'r-cap-2',
  };
  await log(() => gw.capture(authorized.authId, finalCap));
  await log(() => gw.capture(authorized.authId, finalCap));
  await log(() => gw.getHoldTruth(ref));
  await log(() => gw.voidAuthorization(authorized.authId, 'r-void-after-final'));
  await log(() =>
    gw.capture(authorized.authId, {
      amountCents: 100,
      finalCapture: true,
      invoiceId: 'inv-1',
      requestId: 'r-cap-3',
    }),
  );

  // A second hold that is voided.
  const o2 = await gw.createOrder({
    holdId: 'h2',
    ceilingCents: 5000,
    description: 'hold',
    requestId: 'r-order-2',
  });
  core.approveOrder(o2.orderId);
  const a2 = await gw.authorizeOrder(o2.orderId, 'r-auth-2');
  trace.push({ ok: a2 });
  await log(() => gw.voidAuthorization(a2.authId, 'r-void-1'));
  await log(() => gw.voidAuthorization(a2.authId, 'r-void-2'));
  await log(() => gw.getHoldTruth({ holdId: 'h2', authId: a2.authId, orderId: o2.orderId }));
  await log(() =>
    gw.capture(a2.authId, {
      amountCents: 100,
      finalCapture: true,
      invoiceId: 'inv-2',
      requestId: 'r-cap-4',
    }),
  );
  await log(() => gw.reauthorize(a2.authId, { amountCents: 4000, requestId: 'r-reauth-1' }));

  await log(() => gw.getHoldTruth({ holdId: 'hx', authId: 'AUTH-NO-SUCH' }));
  await log(() => gw.getOrder('NO-SUCH-ORDER'));
  return trace;
}

describe('T-PAY-019 conformance: FakeGateway and PayPalGateway over the fake server', () => {
  let a: Rig;
  let b: Rig;

  beforeEach(async () => {
    a = await fakeRig();
    b = await httpRig();
  });
  afterEach(async () => {
    assertFakeInvariants(a.core);
    assertFakeInvariants(b.core);
    await a.close();
    await b.close();
  });

  it('gives identical results for the same scenario', async () => {
    const viaFake = await scenario(a);
    const viaHttp = await scenario(b);
    expect(viaHttp).toEqual(viaFake);
  });

  it('the scenario exercises both successes and failures', async () => {
    const trace = await scenario(b);
    const errors = trace.flatMap((s) => ('error' in s ? [s.error.kind] : []));
    expect(errors).toEqual(
      expect.arrayContaining([
        'rejected',
        'declined',
        'already_captured',
        'already_voided',
        'not_found',
      ]),
    );
    expect(trace.filter((s) => 'ok' in s).length).toBeGreaterThan(10);
  });

  it('truth merges the authorization and the order captures', async () => {
    const { gw, core } = b;
    const o = await gw.createOrder({
      holdId: 'h',
      ceilingCents: 9000,
      description: 'd',
      requestId: 'r-o',
    });
    core.approveOrder(o.orderId);
    const au = await gw.authorizeOrder(o.orderId, 'r-a');
    await gw.capture(au.authId, {
      amountCents: 2500,
      finalCapture: false,
      invoiceId: 'inv',
      requestId: 'r-c',
    });
    const truth = await gw.getHoldTruth({ holdId: 'h', authId: au.authId, orderId: o.orderId });
    expect(truth).toMatchObject({
      status: 'PARTIALLY_CAPTURED',
      amountCents: 9000,
      capturedCents: 2500,
      observedAtMs: START_MS,
    });
    expect(truth.captures).toHaveLength(1);
    expect(truth.captures?.[0]).toMatchObject({ amountCents: 2500, final: false });

    // Without the order id the captures cannot be observed.
    const blind = await gw.getHoldTruth({ holdId: 'h', authId: au.authId });
    expect(blind.captures).toBeNull();
    expect(blind.capturedCents).toBe(0);
    expect(blind.status).toBe('PARTIALLY_CAPTURED');
  });
});

describe('kill switch', () => {
  let engaged = false;
  const ks: KillSwitch = {
    isEngaged: async () => (engaged ? { engaged: true, reason: 'test' } : { engaged: false }),
    engage: async () => undefined,
    release: async () => undefined,
  };
  let rig: Rig;

  beforeEach(async () => {
    engaged = false;
    rig = await httpRig({ killSwitch: ks });
  });
  afterEach(async () => {
    await rig.close();
  });

  it('refuses money-moving calls without reaching PayPal, allows reads and voids', async () => {
    const { gw, core } = rig;
    const o = await gw.createOrder({
      holdId: 'h',
      ceilingCents: 9000,
      description: 'd',
      requestId: 'r-o',
    });
    core.approveOrder(o.orderId);
    const au = await gw.authorizeOrder(o.orderId, 'r-a');

    engaged = true;
    const callsBefore = core.calls.length;
    const refused = [
      await attempt(() =>
        gw.createOrder({ holdId: 'h2', ceilingCents: 100, description: 'd', requestId: 'r-o2' }),
      ),
      await attempt(() => gw.authorizeOrder(o.orderId, 'r-a2')),
      await attempt(() =>
        gw.capture(au.authId, {
          amountCents: 100,
          finalCapture: true,
          invoiceId: 'i',
          requestId: 'r-c',
        }),
      ),
      await attempt(() => gw.reauthorize(au.authId, { amountCents: 100, requestId: 'r-re' })),
    ];
    for (const r of refused) {
      expect(r).toEqual({ error: { kind: 'kill_switch_engaged', outcome: 'definite', status: 0 } });
    }
    expect(core.calls.length).toBe(callsBefore);

    // Reads and voids still work (R-PAY-006).
    await expect(gw.getHoldTruth({ holdId: 'h', authId: au.authId })).resolves.toMatchObject({
      status: 'CREATED',
    });
    await expect(gw.getOrder(o.orderId)).resolves.toMatchObject({ status: 'COMPLETED' });
    await expect(gw.voidAuthorization(au.authId, 'r-v')).resolves.toBeUndefined();
  });
});

describe('observability (R-PAY-019)', () => {
  afterEach(() => clearRegisteredSecrets());

  it('logs the debug id and counts the call and latency of every request', async () => {
    const lines: string[] = [];
    const prev = setLogSink((l) => lines.push(l));
    const metrics = createMetrics();
    const server = new FakePayPalServer({ timers: { sleep: noSleep } });
    await server.start();
    try {
      const transport = new Transport({ sleep: noSleep, metrics });
      const auth = new TokenManager({
        transport,
        baseUrl: server.url,
        clientId: 'fake-client',
        clientSecret: 'fake-secret-value',
      });
      const gw = new PayPalGateway({ auth, fake: true });
      const au = server.core.createAuthorization('buyer', 5000);
      await gw.capture(au.id, {
        amountCents: 5000,
        finalCapture: true,
        invoiceId: 'inv',
        requestId: 'r-c',
      });
      expect(metrics.counter('paypal_calls_total', { op: 'capture', outcome: 'ok' })).toBe(1);
      expect(metrics.histogram('paypal_latency_ms', { op: 'capture' })?.count).toBe(1);
      const logged = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
      const cap = logged.find((l) => l['op'] === 'capture');
      expect(cap?.['debugId']).toMatch(/^fake-debug-/);
      expect(typeof cap?.['latencyMs']).toBe('number');

      const failed = await gw
        .capture(au.id, { amountCents: 1, finalCapture: true, invoiceId: 'i', requestId: 'r-2' })
        .catch((e: unknown) => e);
      expect(failed).toBeInstanceOf(PayPalError);
      expect((failed as PayPalError).debugId).toMatch(/^fake-debug-/);
    } finally {
      setLogSink(prev);
      await server.stop();
    }
  });
});

describe('getHoldTruth edge cases', () => {
  /** An auth whose answers are scripted by path. */
  function scripted(routes: Record<string, unknown>): GatewayAuth {
    return {
      send: async (req): Promise<TransportResult> => {
        const body = routes[req.path];
        if (body === undefined) {
          return {
            status: 404,
            headers: {},
            text: '{"name":"RESOURCE_NOT_FOUND"}',
            attempts: 1,
          };
        }
        return { status: 200, headers: {}, text: JSON.stringify(body), attempts: 1 };
      },
    };
  }
  const authBody = (status: string): unknown => ({
    id: 'A1',
    status,
    amount: { currency_code: 'USD', value: '50.00' },
  });
  const orderBody = (captures: unknown): unknown => ({
    id: 'O1',
    status: 'COMPLETED',
    purchase_units: [{ payments: { captures } }],
  });
  const completed = {
    id: 'C1',
    status: 'COMPLETED',
    final_capture: true,
    invoice_id: 'gavel-a-h',
    amount: { currency_code: 'USD', value: '42.00' },
  };

  it('a final capture on the order makes the hold CAPTURED even if the authorization lags', async () => {
    const gw = new PayPalGateway({
      auth: scripted({
        '/v2/payments/authorizations/A1': authBody('CREATED'),
        '/v2/checkout/orders/O1': orderBody([completed]),
      }),
      fake: true,
    });
    const t = await gw.getHoldTruth({ holdId: 'h', authId: 'A1', orderId: 'O1' });
    expect(t.status).toBe('CAPTURED');
    expect(t.capturedCents).toBe(4200);
    expect(t.captures).toEqual([
      { captureId: 'C1', amountCents: 4200, final: true, invoiceId: 'gavel-a-h' },
    ]);
  });

  it('ignores declined captures', async () => {
    const declined = { ...completed, id: 'C2', status: 'DECLINED' };
    const gw = new PayPalGateway({
      auth: scripted({
        '/v2/payments/authorizations/A1': authBody('CREATED'),
        '/v2/checkout/orders/O1': orderBody([declined]),
      }),
      fake: true,
    });
    const t = await gw.getHoldTruth({ holdId: 'h', authId: 'A1', orderId: 'O1' });
    expect(t).toMatchObject({ status: 'CREATED', capturedCents: 0, captures: [] });
  });

  it('an order that cannot be read leaves captures not observable', async () => {
    const gw = new PayPalGateway({
      auth: scripted({ '/v2/payments/authorizations/A1': authBody('CREATED') }),
      fake: true,
    });
    const t = await gw.getHoldTruth({ holdId: 'h', authId: 'A1', orderId: 'O-GONE' });
    expect(t.captures).toBeNull();
    expect(t.status).toBe('CREATED');
  });

  it('an unknown authorization status is an unknown outcome, not a guess', async () => {
    const gw = new PayPalGateway({
      auth: scripted({ '/v2/payments/authorizations/A1': authBody('SOMETHING_NEW') }),
      fake: true,
    });
    const err = await gw.getHoldTruth({ holdId: 'h', authId: 'A1' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayPalError);
    expect((err as PayPalError).outcome).toBe('unknown');
  });

  it('capturesOf is null for a malformed capture list', () => {
    expect(capturesOf(orderBody('nope'))).toBeNull();
    expect(capturesOf({})).toBeNull();
    expect(capturesOf(orderBody([{ id: 'C', amount: {} }]))).toBeNull();
    expect(capturesOf({ purchase_units: [{}] })).toEqual([]);
  });
});
