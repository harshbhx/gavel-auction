import { afterEach, describe, expect, it } from 'vitest';
import { PayPalError } from '../../src/errors.js';
import { FakeClock } from '../../src/fake/core.js';
import { assertFakeInvariants } from '../../src/fake/invariants.js';
import { FakePayPalServer } from '../../src/fake/server.js';
import { PayPalGateway } from '../../src/gateway.js';
import { MemoryKillStateStore, PersistentKillSwitch } from '../../src/killswitch.js';
import { TokenManager } from '../../src/oauth.js';
import type { PaymentsGateway } from '../../src/ports.js';
import { reconcile } from '../../src/reconcile/reconcile.js';
import {
  DEFAULT_PENDING_CAPTURE_DEADLINE_MS,
  invoiceIdFor,
  runCapturePhase,
} from '../../src/saga/capture.js';
import { createSettlement } from '../../src/saga/create.js';
import { remainderKey } from '../../src/saga/remainder.js';
import { runSettlement, runVoidPhase, type SettlementDeps } from '../../src/saga/void.js';
import { MemoryHoldStore, MemoryJournalStore } from '../../src/stores/memory.js';
import { Transport } from '../../src/transport.js';
import type { PaymentAudit, SettlementPlan } from '../../src/types.js';
import { FRESH_HOLDS } from '../helpers/age.js';

/**
 * Round 12 red-team findings on payments (R12-P01 to R12-P06). Every test runs the saga
 * through PayPalGateway, the client code that talks to PayPal, against the fake PayPal
 * server over HTTP, with the injected clock for long outages.
 */

const START_MS = 1_800_000_000_000;
const MIN = 60_000;
const noSleep = async (): Promise<void> => undefined;
const CEILINGS: Record<string, number> = { b1: 30000, b2: 25000 };

interface World {
  server: FakePayPalServer;
  clock: FakeClock;
  gateway: PayPalGateway;
  journals: MemoryJournalStore;
  plan: SettlementPlan;
  audits: PaymentAudit[];
  deps: SettlementDeps;
  killSwitch: PersistentKillSwitch;
  auth: (bidder: string) => string;
}

const open: FakePayPalServer[] = [];
afterEach(async () => {
  for (const s of open.splice(0)) await s.stop();
});

/** Two approved holds, b1 at 220.00 then b2 at 210.00, settled through the real gateway. */
async function world(): Promise<World> {
  const clock = new FakeClock(START_MS);
  const server = new FakePayPalServer({ timers: { sleep: noSleep }, core: { clock } });
  await server.start();
  open.push(server);
  const audits: PaymentAudit[] = [];
  const audit = { append: async (e: PaymentAudit): Promise<void> => void audits.push(e) };
  const payClock = { nowMs: () => clock.nowMs() };
  const killSwitch = new PersistentKillSwitch({
    store: new MemoryKillStateStore(),
    audit,
    clock: payClock,
  });
  const gateway = new PayPalGateway({
    auth: new TokenManager({
      transport: new Transport({ sleep: noSleep }),
      baseUrl: server.url,
      clientId: 'fake-client',
      clientSecret: 'fake-secret-value',
    }),
    fake: true,
    clock: payClock,
    killSwitch,
  });
  const holds: SettlementPlan['holds'] = {};
  for (const [bidder, cents] of Object.entries(CEILINGS)) {
    const order = server.core.createOrder(
      { holdId: `hold-${bidder}`, amountCents: cents, description: 'r12' },
      `ord-${bidder}`,
    );
    server.core.approveOrder(order.id);
    const a = server.core.authorizeOrder(order.id, `auth-${bidder}`);
    holds[bidder] = {
      holdId: `hold-${bidder}`,
      authId: a.authId,
      ceilingCents: cents,
      createdAtMs: START_MS,
      orderId: order.id,
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
    clock,
    gateway,
    journals,
    plan,
    audits,
    deps: { journals, gateway, audit, clock: payClock, killSwitch },
    killSwitch,
    auth: (bidder) => holds[bidder]?.authId ?? '',
  };
}

function alerts(w: World): PaymentAudit[] {
  return w.audits.filter((a) => a.kind === 'settlement_alert');
}

function voidCallsOn(w: World, authId: string): number {
  return w.server.core.calls.filter((c) => c.op === 'void' && c.id === authId).length;
}

/** b1's capture is answered PENDING; returns its capture id. */
async function pendingOnB1(w: World): Promise<string> {
  w.server.core.inject('capture', 'capture_pending', w.auth('b1'));
  const first = await runSettlement(w.deps, 'auc1');
  expect(first).toMatchObject({ status: 'pending', reason: 'capture_pending' });
  return w.server.core.getAuthorization(w.auth('b1')).captures[0]?.id ?? '';
}

describe('R12-P01 a PENDING capture waits under its own deadline', () => {
  it('is still waited for hours later and booked once PayPal completes it', async () => {
    const w = await world();
    const captureId = await pendingOnB1(w);
    // Two hours: far past the ten-minute deadline of a lost answer.
    w.clock.advance(120 * MIN);
    expect(await runSettlement(w.deps, 'auc1')).toMatchObject({
      status: 'pending',
      reason: 'capture_pending',
    });
    const waiting = await w.journals.load('auc1');
    expect(waiting?.state).toBe('CAPTURING');
    expect(waiting?.intent?.pendingSinceMs).toBe(START_MS);
    expect(w.server.core.inspect(w.auth('b2')).voidEffects).toBe(0);

    w.server.core.completeCapture(captureId);
    const out = await runSettlement(w.deps, 'auc1');
    expect(out.status).toBe('settled');
    if (out.status !== 'settled') return;
    expect(out.journal.winner).toMatchObject({ bidderId: 'b1', captureId, amountCents: 22000 });
    expect(w.server.core.inspect(w.auth('b1')).capturedCents).toBe(22000);
    expect(w.server.core.inspect(w.auth('b2')).voidEffects).toBe(1);
    assertFakeInvariants(w.server.core);
  });

  it('a truth read that fails while the capture is PENDING does not apply the ten-minute deadline', async () => {
    const w = await world();
    const captureId = await pendingOnB1(w);
    w.clock.advance(20 * MIN);
    w.server.faults.add({ kind: 'http_500', op: 'get', times: 10_000 });
    expect(await runSettlement(w.deps, 'auc1')).toMatchObject({
      status: 'pending',
      reason: 'truth_unavailable',
    });
    w.server.faults.clear();
    w.server.core.completeCapture(captureId);
    const out = await runSettlement(w.deps, 'auc1');
    expect(out.status).toBe('settled');
    assertFakeInvariants(w.server.core);
  });

  it('past the pending deadline it goes to review, and a later completion is reported by reconcile', async () => {
    const w = await world();
    const captureId = await pendingOnB1(w);
    w.clock.advance(DEFAULT_PENDING_CAPTURE_DEADLINE_MS + MIN);
    const out = await runSettlement(w.deps, 'auc1');
    expect(out).toMatchObject({ status: 'failed', reason: 'capture_outcome_unknown' });
    // Both holds stay: the capture can still happen, and the lot can still fall back.
    expect(w.server.core.inspect(w.auth('b1')).voidEffects).toBe(0);
    expect(w.server.core.inspect(w.auth('b2')).voidEffects).toBe(0);

    w.server.core.completeCapture(captureId);
    const report = await reconcile(
      {
        gateway: w.gateway,
        journals: w.journals,
        holds: new MemoryHoldStore(),
        clock: { nowMs: () => w.clock.nowMs() },
      },
      'auc1',
    );
    expect(report.journalState).toBe('FAILED_NEEDS_REVIEW');
    expect(report.findings).toContainEqual(
      expect.objectContaining({ code: 'EXTRA_CAPTURE', holdId: 'hold-b1' }),
    );
  });
});

describe('R12-P02 a slow release never ends a paid sale in review', () => {
  /** b1 is captured; every void of b2 and every read of its authorization fails with 5xx. */
  async function saleWithB2Down(): Promise<World> {
    const w = await world();
    w.server.faults.add({ kind: 'http_500', op: 'void', authId: w.auth('b2'), times: 10_000 });
    w.server.faults.add({ kind: 'http_500', op: 'get', authId: w.auth('b2'), times: 10_000 });
    expect(await runSettlement(w.deps, 'auc1')).toMatchObject({
      status: 'pending',
      reason: 'void_incomplete',
    });
    const j = await w.journals.load('auc1');
    expect(j?.state).toBe('VOIDING');
    expect(j?.winner?.bidderId).toBe('b1');
    return w;
  }

  it('retries the void before judging its age: PayPal back at minute 9, run at minute 11 settles', async () => {
    const w = await saleWithB2Down();
    w.clock.advance(9 * MIN);
    expect(await runSettlement(w.deps, 'auc1')).toMatchObject({ status: 'pending' });
    w.server.faults.clear();
    w.clock.advance(2 * MIN);
    const out = await runSettlement(w.deps, 'auc1');
    expect(out.status).toBe('settled');
    if (out.status !== 'settled') return;
    expect(out.journal.winner).toMatchObject({ bidderId: 'b1', amountCents: 22000 });
    expect(w.server.core.inspect(w.auth('b2')).voidEffects).toBe(1);
    expect(alerts(w)).toEqual([]);
    assertFakeInvariants(w.server.core);
  });

  it('a long outage raises one alert and keeps the sale VOIDING until PayPal answers', async () => {
    const w = await saleWithB2Down();
    w.clock.advance(11 * MIN);
    expect(await runSettlement(w.deps, 'auc1')).toMatchObject({
      status: 'pending',
      reason: 'void_incomplete',
    });
    w.clock.advance(60 * MIN);
    expect(await runSettlement(w.deps, 'auc1')).toMatchObject({ status: 'pending' });
    expect(alerts(w)).toEqual([
      expect.objectContaining({
        kind: 'settlement_alert',
        auctionId: 'auc1',
        holdId: 'hold-b2',
        label: 'void_unconfirmed:b2',
      }),
    ]);
    expect((await w.journals.load('auc1'))?.state).toBe('VOIDING');

    w.server.faults.clear();
    const out = await runSettlement(w.deps, 'auc1');
    expect(out.status).toBe('settled');
    expect(w.server.core.inspect(w.auth('b2')).voidEffects).toBe(1);
    assertFakeInvariants(w.server.core);
  });

  it('an unreadable winner remainder raises one alert and settles once it can be read', async () => {
    const w = await world();
    expect((await runCapturePhase(w.deps, 'auc1')).status).toBe('captured');
    w.server.faults.add({ kind: 'http_500', op: 'get', authId: w.auth('b1'), times: 10_000 });
    expect(await runVoidPhase(w.deps, 'auc1')).toMatchObject({
      status: 'pending',
      reason: 'remainder_unavailable',
    });
    w.clock.advance(11 * MIN);
    expect(await runVoidPhase(w.deps, 'auc1')).toMatchObject({
      status: 'pending',
      reason: 'remainder_unavailable',
    });
    expect(alerts(w).map((a) => a.label)).toEqual(['remainder_unconfirmed']);

    w.server.faults.clear();
    const out = await runVoidPhase(w.deps, 'auc1');
    expect(out.status).toBe('settled');
    if (out.status !== 'settled') return;
    expect(out.journal.voids[remainderKey('b1')]).toBe('remainder_released');
    assertFakeInvariants(w.server.core);
  });
});

/** Wraps a gateway so the first capture takes effect at PayPal but its answer is lost. */
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

describe('R12-P03 an order that cannot be read is an unknown outcome', () => {
  async function capturedB1(w: World): Promise<{ authId: string; orderId: string }> {
    const hold = w.plan.holds['b1'];
    if (hold === undefined || hold.orderId === undefined) throw new Error('rig');
    await w.gateway.capture(hold.authId, {
      amountCents: 22000,
      finalCapture: true,
      invoiceId: invoiceIdFor('auc1', hold.holdId),
      requestId: 'r12-p03-capture',
    });
    return { authId: hold.authId, orderId: hold.orderId };
  }

  it('a truncated order body throws an unknown outcome instead of hiding the captures', async () => {
    const w = await world();
    const h = await capturedB1(w);
    // The authorization GET answers; the order GET after it comes back truncated (H14).
    w.server.faults.add({ kind: 'malformed_body', op: 'get', times: 1, afterNthCall: 1 });
    const err = await w.gateway.getHoldTruth({ holdId: 'hold-b1', ...h }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayPalError);
    expect(err).toMatchObject({ outcome: 'unknown', name: 'ORDER_UNREADABLE' });
    // The next read sees the capture.
    const truth = await w.gateway.getHoldTruth({ holdId: 'hold-b1', ...h });
    expect(truth).toMatchObject({ status: 'CAPTURED', capturedCents: 22000 });
  });

  it('a 404 on the order is an unknown outcome, not an order without captures', async () => {
    const w = await world();
    const h = await capturedB1(w);
    const err = await w.gateway
      .getHoldTruth({ holdId: 'hold-b1', authId: h.authId, orderId: 'NO-SUCH-ORDER' })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ outcome: 'unknown', name: 'ORDER_UNREADABLE' });
  });

  it('a lost capture answer followed by a truncated order read is adopted, not sent to review', async () => {
    const w = await world();
    const deps: SettlementDeps = { ...w.deps, gateway: loseCaptureAnswer(w.gateway) };
    expect(await runSettlement(deps, 'auc1')).toMatchObject({
      status: 'pending',
      reason: 'capture_outcome_unknown',
    });
    expect(w.server.core.inspect(w.auth('b1')).capturedCents).toBe(22000);

    w.server.faults.add({ kind: 'malformed_body', op: 'get', times: 1, afterNthCall: 1 });
    expect(await runSettlement(deps, 'auc1')).toMatchObject({
      status: 'pending',
      reason: 'truth_unavailable',
    });

    const out = await runSettlement(deps, 'auc1');
    expect(out.status).toBe('settled');
    if (out.status !== 'settled') return;
    expect(out.journal.winner).toMatchObject({ bidderId: 'b1', amountCents: 22000 });
    expect(out.journal.history.map((h) => h.label)).toContain('journaled:adopted');
    expect(w.server.core.inspect(w.auth('b1')).capturedCents).toBe(22000);
    assertFakeInvariants(w.server.core);
  });
});

describe('R12-P05 the kill switch pauses the unknown clock', () => {
  /** b1's capture answer is a 5xx: the outcome is unknown from START_MS on. */
  async function unknownOnB1(w: World, recover = true): Promise<void> {
    w.server.faults.add({ kind: 'http_500', op: 'capture', times: 10_000 });
    expect(await runCapturePhase(w.deps, 'auc1')).toMatchObject({
      status: 'pending',
      reason: 'capture_outcome_unknown',
    });
    if (recover) w.server.faults.clear();
  }

  it('engaged at minute 1, released at minute 30: the retry captures once', async () => {
    const w = await world();
    await unknownOnB1(w);
    w.clock.advance(MIN);
    await w.killSwitch.engage('incident', 'ops-1');
    w.clock.advance(29 * MIN);
    expect(await runCapturePhase(w.deps, 'auc1')).toMatchObject({
      status: 'pending',
      reason: 'kill_switch',
    });
    expect((await w.journals.load('auc1'))?.unknownPausedAtMs).toBe(START_MS + MIN);

    await w.killSwitch.release('ops-1');
    const out = await runCapturePhase(w.deps, 'auc1');
    expect(out.status).toBe('captured');
    if (out.status !== 'captured') return;
    expect(out.journal.winner).toMatchObject({ bidderId: 'b1', amountCents: 22000 });
    expect(out.journal.unknownPausedAtMs).toBeUndefined();
    // One capture: the retry reused the request id of the first attempt.
    expect(w.server.core.getAuthorization(w.auth('b1')).captures).toHaveLength(1);
    assertFakeInvariants(w.server.core);
  });

  it('time outside the engaged span still counts toward the deadline', async () => {
    const w = await world();
    // PayPal keeps answering the capture with 5xx throughout.
    await unknownOnB1(w, false);
    w.clock.advance(9 * MIN);
    await w.killSwitch.engage('incident', 'ops-1');
    w.clock.advance(MIN);
    expect(await runCapturePhase(w.deps, 'auc1')).toMatchObject({ reason: 'kill_switch' });
    w.clock.advance(60 * MIN);
    await w.killSwitch.release('ops-1');
    // Nine minutes counted before the switch: the retry after the release is still allowed.
    expect(await runCapturePhase(w.deps, 'auc1')).toMatchObject({
      status: 'pending',
      reason: 'capture_outcome_unknown',
    });
    // Two more minutes: eleven in all, past the ten-minute deadline.
    w.clock.advance(2 * MIN);
    const out = await runCapturePhase(w.deps, 'auc1');
    expect(out).toMatchObject({ status: 'failed', reason: 'capture_outcome_unknown' });
    expect(w.server.core.getAuthorization(w.auth('b1')).captures).toHaveLength(0);
  });
});

describe('R12-P06 decision A: no remainder void after a verified final capture', () => {
  it('a sale sends no void to the winner and records the remainder released', async () => {
    const w = await world();
    const out = await runSettlement(w.deps, 'auc1');
    expect(out.status).toBe('settled');
    if (out.status !== 'settled') return;
    expect(out.journal.voids[remainderKey('b1')]).toBe('remainder_released');
    // G1.7: that void could only be refused with PREVIOUSLY_CAPTURED.
    expect(voidCallsOn(w, w.auth('b1'))).toBe(0);
    expect(w.audits.filter((a) => a.op === 'void' && a.holdId === 'hold-b1')).toEqual([]);
    expect(voidCallsOn(w, w.auth('b2'))).toBe(1);
    assertFakeInvariants(w.server.core);
  });

  it('an unanswered remainder void can no longer hold up the sale: there is none', async () => {
    const w = await world();
    w.server.faults.add({ kind: 'http_500', op: 'void', authId: w.auth('b1'), times: 10_000 });
    const out = await runSettlement(w.deps, 'auc1');
    expect(out.status).toBe('settled');
  });
});
