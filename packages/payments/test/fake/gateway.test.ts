import { describe, expect, it } from 'vitest';
import { PayPalError } from '../../src/errors.js';
import { FakeClock, FakePayPalCore } from '../../src/fake/core.js';
import { FakeGateway } from '../../src/fake/gateway.js';

function mk(): { gw: FakeGateway; core: FakePayPalCore; clock: FakeClock } {
  const clock = new FakeClock(5000);
  const core = new FakePayPalCore({ clock });
  return { gw: new FakeGateway(core), core, clock };
}

async function fails(p: Promise<unknown>): Promise<PayPalError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof PayPalError) return e;
    throw e;
  }
  throw new Error('expected a PayPalError');
}

async function hold(
  gw: FakeGateway,
  core: FakePayPalCore,
  cents = 1000,
): Promise<{ orderId: string; authId: string }> {
  const { orderId } = await gw.createOrder({
    holdId: 'h1',
    ceilingCents: cents,
    description: 'hold',
    requestId: `ro-${core.authCount()}`,
  });
  core.approveOrder(orderId);
  const { authId } = await gw.authorizeOrder(orderId, `ra-${core.authCount()}`);
  return { orderId, authId };
}

describe('FakeGateway implements the PaymentsGateway port', () => {
  it('runs order, approval, authorize, capture without HTTP', async () => {
    const { gw, core } = mk();
    const { orderId, authId } = await hold(gw, core);
    expect(await gw.getOrder(orderId)).toMatchObject({
      orderId,
      status: 'COMPLETED',
      authId,
      authStatus: 'CREATED',
    });
    const cap = await gw.capture(authId, {
      amountCents: 600,
      finalCapture: true,
      invoiceId: 'gavel-a1-h1',
      requestId: 'rc1',
    });
    expect(cap.amountCents).toBe(600);
    const truth = await gw.getHoldTruth({ holdId: 'h1', authId, orderId: 'o1' });
    expect(truth).toMatchObject({
      holdId: 'h1',
      authId,
      status: 'CAPTURED',
      amountCents: 1000,
      capturedCents: 600,
      observedAtMs: 5000,
    });
    expect(truth.captures).toEqual([
      { captureId: cap.captureId, amountCents: 600, final: true, invoiceId: 'gavel-a1-h1' },
    ]);
    const blind = await gw.getHoldTruth({ holdId: 'h1', authId });
    expect(blind.captures).toBeNull();
    expect(blind.capturedCents).toBe(0);
    expect(core.checkInvariants()).toBe(true);
  });

  it('createOrder returns an approve url and getOrder shows an unapproved order', async () => {
    const { gw } = mk();
    const o = await gw.createOrder({
      holdId: 'h9',
      ceilingCents: 500,
      description: 'd',
      requestId: 'r',
    });
    expect(o.approveUrl).toContain(o.orderId);
    expect(await gw.getOrder(o.orderId)).toEqual({ orderId: o.orderId, status: 'CREATED' });
  });

  it('authorize before approval is a definite rejection', async () => {
    const { gw } = mk();
    const o = await gw.createOrder({
      holdId: 'h',
      ceilingCents: 500,
      description: 'd',
      requestId: 'r',
    });
    const err = await fails(gw.authorizeOrder(o.orderId, 'ra'));
    expect(err).toMatchObject({ kind: 'rejected', outcome: 'definite', status: 422 });
  });

  it('replays an idempotent POST and rejects different params', async () => {
    const { gw, core } = mk();
    const { authId } = await hold(gw, core);
    const i = { amountCents: 400, finalCapture: false, invoiceId: 'x', requestId: 'same' };
    const a = await gw.capture(authId, i);
    const b = await gw.capture(authId, i);
    expect(b.captureId).toBe(a.captureId);
    const err = await fails(gw.capture(authId, { ...i, amountCents: 500 }));
    expect(err.kind).toBe('idempotency_conflict');
  });

  it('truth of an unknown authorization is NOT_FOUND, not an error', async () => {
    const { gw } = mk();
    const truth = await gw.getHoldTruth({ holdId: 'h', authId: 'AUTH-404' });
    expect(truth.status).toBe('NOT_FOUND');
    expect(truth.capturedCents).toBe(0);
  });

  it('void succeeds once, then reports already_voided', async () => {
    const { gw, core } = mk();
    const { authId } = await hold(gw, core);
    await gw.voidAuthorization(authId, 'v1');
    expect((await gw.getHoldTruth({ holdId: 'h1', authId })).status).toBe('VOIDED');
    const err = await fails(gw.voidAuthorization(authId, 'v2'));
    expect(err).toMatchObject({ kind: 'already_voided', outcome: 'definite' });
    expect(core.inspect(authId).voidEffects).toBe(1);
  });

  it('capture on a voided authorization maps to already_voided', async () => {
    const { gw, core } = mk();
    const { authId } = await hold(gw, core);
    await gw.voidAuthorization(authId, 'v1');
    const err = await fails(
      gw.capture(authId, { amountCents: 100, finalCapture: true, invoiceId: 'i', requestId: 'c' }),
    );
    expect(err.kind).toBe('already_voided');
  });

  it('a second final capture maps to already_captured', async () => {
    const { gw, core } = mk();
    const { authId } = await hold(gw, core);
    const i = { amountCents: 100, finalCapture: true, invoiceId: 'i' };
    await gw.capture(authId, { ...i, requestId: 'c1' });
    const err = await fails(gw.capture(authId, { ...i, requestId: 'c2' }));
    expect(err.kind).toBe('already_captured');
  });

  it('an expired authorization reports EXPIRED and expired on capture', async () => {
    const { gw, core, clock } = mk();
    const { authId } = await hold(gw, core);
    clock.advance(30 * 86_400_000);
    expect((await gw.getHoldTruth({ holdId: 'h1', authId })).status).toBe('EXPIRED');
    const err = await fails(
      gw.capture(authId, { amountCents: 100, finalCapture: true, invoiceId: 'i', requestId: 'c' }),
    );
    expect(err.kind).toBe('expired');
  });

  it('reauthorize follows the honor period', async () => {
    const { gw, core, clock } = mk();
    const { authId } = await hold(gw, core);
    const early = await fails(gw.reauthorize(authId, { amountCents: 1000, requestId: 'ra1' }));
    expect(early.outcome).toBe('definite');
    clock.advance(4 * 86_400_000);
    const renewed = await gw.reauthorize(authId, { amountCents: 1000, requestId: 'ra2' });
    // R11-O06: the funds are held under a new authorization id.
    expect(renewed.amountCents).toBe(1000);
    expect(renewed.authId).not.toBe(authId);
    expect(core.getAuthorization(renewed.authId).status).toBe('CREATED');
  });

  it('a timeout fault is a network error with unknown outcome, and the effect may have happened', async () => {
    const { gw, core } = mk();
    const { authId } = await hold(gw, core);
    core.inject('capture', 'timeout_after_success', authId);
    const err = await fails(
      gw.capture(authId, { amountCents: 700, finalCapture: true, invoiceId: 'i', requestId: 'c' }),
    );
    expect(err).toMatchObject({ kind: 'network', outcome: 'unknown', status: 0 });
    expect((await gw.getHoldTruth({ holdId: 'h1', authId, orderId: 'o1' })).capturedCents).toBe(
      700,
    );
  });

  it('http_500 is a server_error with unknown outcome and nothing applied', async () => {
    const { gw, core } = mk();
    const { authId } = await hold(gw, core);
    core.inject('capture', 'http_500', authId);
    const err = await fails(
      gw.capture(authId, { amountCents: 700, finalCapture: true, invoiceId: 'i', requestId: 'c' }),
    );
    expect(err).toMatchObject({ kind: 'server_error', outcome: 'unknown' });
    expect((await gw.getHoldTruth({ holdId: 'h1', authId })).capturedCents).toBe(0);
  });

  it('a declined capture is definite', async () => {
    const { gw, core } = mk();
    const { authId } = await hold(gw, core);
    core.inject('capture', 'capture_declined', authId);
    const err = await fails(
      gw.capture(authId, { amountCents: 700, finalCapture: true, invoiceId: 'i', requestId: 'c' }),
    );
    expect(err).toMatchObject({ kind: 'declined', outcome: 'definite' });
  });

  it('uses an injected clock for observedAtMs', async () => {
    const core = new FakePayPalCore({ clock: new FakeClock(1) });
    const gw = new FakeGateway(core, { clock: { nowMs: () => 99 } });
    const truth = await gw.getHoldTruth({ holdId: 'h', authId: 'nope' });
    expect(truth.observedAtMs).toBe(99);
  });
});
