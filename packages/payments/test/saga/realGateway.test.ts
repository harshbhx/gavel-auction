import { afterEach, describe, expect, it } from 'vitest';
import { PayPalError } from '../../src/errors.js';
import { assertFakeInvariants } from '../../src/fake/invariants.js';
import { FakeClock } from '../../src/fake/core.js';
import { FakePayPalServer } from '../../src/fake/server.js';
import { PayPalGateway } from '../../src/gateway.js';
import { TokenManager } from '../../src/oauth.js';
import type { PaymentsGateway } from '../../src/ports.js';
import { invoiceIdFor } from '../../src/saga/capture.js';
import { createSettlement } from '../../src/saga/create.js';
import { runSettlement, type SettlementDeps } from '../../src/saga/void.js';
import { MemoryJournalStore } from '../../src/stores/memory.js';
import { Transport } from '../../src/transport.js';
import type { SettlementPlan } from '../../src/types.js';
import { FRESH_HOLDS } from '../helpers/age.js';

const START_MS = 1_800_000_000_000;
const noSleep = async (): Promise<void> => undefined;
const CEILINGS: Record<string, number> = { b1: 30000, b2: 25000 };

interface World {
  server: FakePayPalServer;
  real: PayPalGateway;
  journals: MemoryJournalStore;
  plan: SettlementPlan;
  deps: (gateway: PaymentsGateway) => SettlementDeps;
}

const open: FakePayPalServer[] = [];
afterEach(async () => {
  for (const s of open.splice(0)) await s.stop();
});

/** The real gateway code over HTTP against the fake server, two approved holds. */
async function world(withOrderIds = true): Promise<World> {
  const clock = new FakeClock(START_MS);
  const server = new FakePayPalServer({ timers: { sleep: noSleep }, core: { clock } });
  await server.start();
  open.push(server);
  const auth = new TokenManager({
    transport: new Transport({ sleep: noSleep }),
    baseUrl: server.url,
    clientId: 'fake-client',
    clientSecret: 'fake-secret-value',
  });
  const real = new PayPalGateway({
    auth,
    fake: true,
    clock: { nowMs: () => clock.nowMs() },
  });
  const holds: SettlementPlan['holds'] = {};
  for (const [bidder, cents] of Object.entries(CEILINGS)) {
    const order = server.core.createOrder(
      { holdId: `hold-${bidder}`, amountCents: cents, description: 'real gateway' },
      `ord-${bidder}`,
    );
    server.core.approveOrder(order.id);
    const a = server.core.authorizeOrder(order.id, `auth-${bidder}`);
    holds[bidder] = {
      holdId: `hold-${bidder}`,
      authId: a.authId,
      ceilingCents: cents,
      createdAtMs: START_MS,
      ...(withOrderIds ? { orderId: order.id } : {}),
    };
  }
  const plan: SettlementPlan = {
    auctionId: 'auc1',
    reserveCents: 5000,
    candidates: [
      { bidderId: 'b1', priceCents: 22000 },
      { bidderId: 'b2', priceCents: 21000 },
    ],
    holds,
  };
  const journals = new MemoryJournalStore();
  await createSettlement({ journals, ...FRESH_HOLDS }, plan);
  return {
    server,
    real,
    journals,
    plan,
    deps: (gateway) => ({
      journals,
      gateway,
      audit: { append: async () => undefined },
      clock: { nowMs: () => clock.nowMs() },
    }),
  };
}

/** Wraps a gateway so the capture takes effect at PayPal but its answer is lost. */
function loseCaptureAnswer(base: PaymentsGateway): PaymentsGateway {
  let lost = false;
  return {
    createOrder: (i) => base.createOrder(i),
    getOrder: (id) => base.getOrder(id),
    authorizeOrder: (id, r) => base.authorizeOrder(id, r),
    getHoldTruth: (h) => base.getHoldTruth(h),
    voidAuthorization: (a, r) => base.voidAuthorization(a, r),
    reauthorize: (a, i) => base.reauthorize(a, i),
    capture: async (a, i) => {
      const out = await base.capture(a, i);
      if (lost) return out;
      lost = true;
      throw new PayPalError({
        kind: 'network',
        status: 0,
        name: 'NETWORK',
        message: 'response lost',
        outcome: 'unknown',
      });
    },
  };
}

describe('R8-P02 a clean sale through the real gateway settles', () => {
  it('captures, releases the losers and ends SETTLED, not FAILED_NEEDS_REVIEW', async () => {
    const w = await world();
    const out = await runSettlement(w.deps(w.real), 'auc1');
    expect(out.status).toBe('settled');
    const winner = w.plan.holds['b1'];
    const loser = w.plan.holds['b2'];
    expect(w.server.core.inspect(winner?.authId ?? '').capturedCents).toBe(22000);
    expect(w.server.core.inspect(loser?.authId ?? '').voidEffects).toBe(1);
    assertFakeInvariants(w.server.core);
  });

  it('R8-P08 the saga never reauthorizes by itself: reauthorization is an explicit call', async () => {
    const w = await world();
    await runSettlement(w.deps(w.real), 'auc1');
    expect(w.server.core.calls.filter((c) => c.op === 'reauthorize')).toHaveLength(0);
  });
});

describe('R8-P01 a capture whose answer was lost is adopted on resume', () => {
  it('reads the capture through the order, adopts it and voids the loser', async () => {
    const w = await world();
    const gateway = loseCaptureAnswer(w.real);
    const first = await runSettlement(w.deps(gateway), 'auc1');
    expect(first.status).not.toBe('settled');
    const winner = w.plan.holds['b1'];
    expect(w.server.core.inspect(winner?.authId ?? '').capturedCents).toBe(22000);

    const second = await runSettlement(w.deps(gateway), 'auc1');
    expect(second.status).toBe('settled');
    if (second.status !== 'settled') return;
    expect(second.journal.winner?.bidderId).toBe('b1');
    // One capture only: nothing was captured twice.
    expect(w.server.core.inspect(winner?.authId ?? '').capturedCents).toBe(22000);
    const loser = w.plan.holds['b2'];
    expect(w.server.core.inspect(loser?.authId ?? '').voidEffects).toBe(1);
    assertFakeInvariants(w.server.core);
  });

  it('the journal carries the order id of every hold', async () => {
    const w = await world();
    const j = await w.journals.load('auc1');
    expect(j?.holds['b1']?.orderId).toBe(w.plan.holds['b1']?.orderId);
    expect(j?.holds['b2']?.orderId).toBe(w.plan.holds['b2']?.orderId);
  });
});

describe('fake PayPal server contract: what the real API returns', () => {
  it('a capture echoes the invoice id and the order lists it with the capture', async () => {
    const w = await world();
    const hold = w.plan.holds['b1'];
    if (hold === undefined || hold.orderId === undefined) throw new Error('rig');
    const invoiceId = invoiceIdFor('auc1', hold.holdId);
    const cap = await w.real.capture(hold.authId, {
      amountCents: 22000,
      finalCapture: true,
      invoiceId,
      requestId: 'contract-capture',
    });
    const truth = await w.real.getHoldTruth({
      holdId: hold.holdId,
      authId: hold.authId,
      orderId: hold.orderId,
    });
    expect(truth.status).toBe('CAPTURED');
    expect(truth.capturedCents).toBe(22000);
    expect(truth.captures).toEqual([
      { captureId: cap.captureId, amountCents: 22000, final: true, invoiceId },
    ]);
  });

  it('without the order id the captures are not observable, as on the real gateway', async () => {
    const w = await world();
    const hold = w.plan.holds['b1'];
    if (hold === undefined) throw new Error('rig');
    await w.real.capture(hold.authId, {
      amountCents: 22000,
      finalCapture: true,
      invoiceId: 'inv',
      requestId: 'contract-capture-2',
    });
    const truth = await w.real.getHoldTruth({ holdId: hold.holdId, authId: hold.authId });
    expect(truth.status).toBe('CAPTURED');
    expect(truth.captures).toBeNull();
    expect(truth.capturedCents).toBe(0);
  });

  it('a void after a final capture answers the verified PREVIOUSLY_CAPTURED', async () => {
    const w = await world();
    const hold = w.plan.holds['b1'];
    if (hold === undefined) throw new Error('rig');
    await w.real.capture(hold.authId, {
      amountCents: 22000,
      finalCapture: true,
      invoiceId: 'inv',
      requestId: 'contract-capture-3',
    });
    const err = await w.real.voidAuthorization(hold.authId, 'contract-void').catch((e) => e);
    expect(err).toBeInstanceOf(PayPalError);
    expect(err).toMatchObject({ kind: 'already_captured', issue: 'PREVIOUSLY_CAPTURED' });
  });
});
