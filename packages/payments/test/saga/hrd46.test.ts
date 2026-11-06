import { afterEach, describe, expect, it } from 'vitest';
import { PayPalError } from '../../src/errors.js';
import { FakeClock } from '../../src/fake/core.js';
import { assertFakeInvariants } from '../../src/fake/invariants.js';
import { FakePayPalServer } from '../../src/fake/server.js';
import { PayPalGateway, type GatewayAuth } from '../../src/gateway.js';
import { TokenManager } from '../../src/oauth.js';
import type { PaymentsGateway } from '../../src/ports.js';
import { runCapturePhase } from '../../src/saga/capture.js';
import { createSettlement } from '../../src/saga/create.js';
import { runSettlement, runVoidPhase, type SettlementDeps } from '../../src/saga/void.js';
import { MemoryJournalStore } from '../../src/stores/memory.js';
import { Transport, type TransportResult } from '../../src/transport.js';
import type { HoldTruth, SettlementPlan } from '../../src/types.js';
import { FRESH_HOLDS } from '../helpers/age.js';
import { callsOf, makeRig, seed, withGateway } from './rig.js';

/**
 * HRD-46: one 404 on the authorization read must not count as "hold gone". The saga must
 * not capture the runner-up while the winner's capture is in doubt, and must not record a
 * hold that may be live as released.
 */

const START_MS = 1_800_000_000_000;
const MIN = 60_000;
const noSleep = async (): Promise<void> => undefined;
const CEILINGS: Record<string, number> = { b1: 30000, b2: 25000 };

const NOT_FOUND_ANSWER: TransportResult = {
  status: 404,
  headers: {},
  text: JSON.stringify({
    name: 'RESOURCE_NOT_FOUND',
    message: 'The specified resource does not exist.',
    details: [{ issue: 'INVALID_RESOURCE_ID' }],
  }),
  attempts: 1,
};

const AUTH_PATH = /^\/v2\/payments\/authorizations\/([^/]+)$/;

interface World {
  server: FakePayPalServer;
  clock: FakeClock;
  gateway: PayPalGateway;
  journals: MemoryJournalStore;
  deps: SettlementDeps;
  auth: (bidder: string) => string;
  order: (bidder: string) => string;
  /** The next `times` reads of this authorization answer 404 (Infinity: every read). */
  missing: (authId: string, times: number) => void;
}

const open: FakePayPalServer[] = [];
afterEach(async () => {
  for (const s of open.splice(0)) await s.stop();
});

/**
 * Two approved holds, b1 at 220.00 then b2 at 210.00, settled through PayPalGateway over
 * HTTP against the fake PayPal server. A 404 can be put in front of the authorization read.
 */
async function world(): Promise<World> {
  const clock = new FakeClock(START_MS);
  const server = new FakePayPalServer({ timers: { sleep: noSleep }, core: { clock } });
  await server.start();
  open.push(server);
  const tokens = new TokenManager({
    transport: new Transport({ sleep: noSleep }),
    baseUrl: server.url,
    clientId: 'fake-client',
    clientSecret: 'fake-secret-value',
  });
  const left = new Map<string, number>();
  const auth: GatewayAuth = {
    send: async (req) => {
      const raw = AUTH_PATH.exec(req.path)?.[1];
      const id = raw === undefined ? undefined : decodeURIComponent(raw);
      const n = id === undefined ? 0 : (left.get(id) ?? 0);
      if (req.method === 'GET' && id !== undefined && n > 0) {
        left.set(id, n - 1);
        return NOT_FOUND_ANSWER;
      }
      return tokens.send(req);
    },
  };
  const payClock = { nowMs: () => clock.nowMs() };
  const gateway = new PayPalGateway({ auth, fake: true, clock: payClock });
  const holds: SettlementPlan['holds'] = {};
  for (const [bidder, cents] of Object.entries(CEILINGS)) {
    const order = server.core.createOrder(
      { holdId: `hold-${bidder}`, amountCents: cents, description: 'hrd46' },
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
    deps: { journals, gateway, audit: { append: async () => undefined }, clock: payClock },
    auth: (bidder) => holds[bidder]?.authId ?? '',
    order: (bidder) => holds[bidder]?.orderId ?? '',
    missing: (authId, times) => void left.set(authId, times),
  };
}

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

function captureCallsOn(w: World, authId: string): number {
  return w.server.core.calls.filter((c) => c.op === 'capture' && c.id === authId).length;
}

describe('HRD-46 the gateway confirms a 404 on the authorization read', () => {
  it('a single 404 is read again and the live hold is seen', async () => {
    const w = await world();
    w.missing(w.auth('b1'), 1);
    const truth = await w.gateway.getHoldTruth({
      holdId: 'hold-b1',
      authId: w.auth('b1'),
      orderId: w.order('b1'),
    });
    expect(truth).toMatchObject({ status: 'CREATED', amountCents: 30000, capturedCents: 0 });
  });

  it('a 404 that persists while the order lists the authorization is an unknown outcome', async () => {
    const w = await world();
    w.missing(w.auth('b1'), Number.POSITIVE_INFINITY);
    const err = await w.gateway
      .getHoldTruth({ holdId: 'hold-b1', authId: w.auth('b1'), orderId: w.order('b1') })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayPalError);
    expect(err).toMatchObject({
      outcome: 'unknown',
      name: 'AUTHORIZATION_NOT_FOUND_UNCONFIRMED',
    });
  });

  it('a 404 on the authorization and on the order is an unknown outcome', async () => {
    const w = await world();
    const err = await w.gateway
      .getHoldTruth({ holdId: 'hold-x', authId: 'AUTH-NO-SUCH', orderId: 'ORDER-NO-SUCH' })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({
      outcome: 'unknown',
      name: 'AUTHORIZATION_NOT_FOUND_UNCONFIRMED',
    });
  });

  it('is NOT_FOUND only when the order lists no authorization and no capture', async () => {
    const w = await world();
    const order = w.server.core.createOrder(
      { holdId: 'hold-x', amountCents: 1000, description: 'never authorized' },
      'ord-x',
    );
    w.server.core.approveOrder(order.id);
    const truth = await w.gateway.getHoldTruth({
      holdId: 'hold-x',
      authId: 'AUTH-NO-SUCH',
      orderId: order.id,
    });
    expect(truth).toMatchObject({ status: 'NOT_FOUND', capturedCents: 0 });
  });
});

describe('HRD-46 a capture in doubt is never followed by the runner-up', () => {
  it('a lost capture answer then one 404 adopts the winner, the runner-up is not charged', async () => {
    const w = await world();
    const deps: SettlementDeps = { ...w.deps, gateway: loseCaptureAnswer(w.gateway) };
    expect(await runSettlement(deps, 'auc1')).toMatchObject({
      status: 'pending',
      reason: 'capture_outcome_unknown',
    });
    expect(w.server.core.inspect(w.auth('b1')).capturedCents).toBe(22000);

    w.missing(w.auth('b1'), 1);
    const out = await runSettlement(deps, 'auc1');
    expect(out.status).toBe('settled');
    if (out.status !== 'settled') return;
    expect(out.journal.winner).toMatchObject({ bidderId: 'b1', amountCents: 22000 });
    expect(out.journal.failed).toEqual([]);
    expect(captureCallsOn(w, w.auth('b2'))).toBe(0);
    expect(w.server.core.inspect(w.auth('b2')).capturedCents).toBe(0);
    assertFakeInvariants(w.server.core);
  });

  it('a 404 that persists keeps the intent, reaches review and keeps both holds', async () => {
    const w = await world();
    const deps: SettlementDeps = { ...w.deps, gateway: loseCaptureAnswer(w.gateway) };
    await runSettlement(deps, 'auc1');
    w.missing(w.auth('b1'), Number.POSITIVE_INFINITY);

    expect(await runSettlement(deps, 'auc1')).toMatchObject({ status: 'pending' });
    const waiting = await w.journals.load('auc1');
    expect(waiting?.state).toBe('CAPTURING');
    expect(waiting?.intent).toMatchObject({ op: 'capture', holdId: 'hold-b1' });

    w.clock.advance(11 * MIN);
    const out = await runSettlement(deps, 'auc1');
    expect(out).toMatchObject({ status: 'failed', reason: 'capture_outcome_unknown' });
    const review = await w.journals.load('auc1');
    expect(review?.state).toBe('FAILED_NEEDS_REVIEW');
    expect(review?.winner).toBeNull();
    expect(review?.failed).toEqual([]);
    expect(review?.voids['b1']).toBeUndefined();
    expect(captureCallsOn(w, w.auth('b2'))).toBe(0);
    expect(w.server.core.inspect(w.auth('b2')).voidEffects).toBe(0);
    assertFakeInvariants(w.server.core);
  });

  it('a PENDING capture is waited for while the authorization answers 404', async () => {
    const w = await world();
    w.server.core.inject('capture', 'capture_pending', w.auth('b1'));
    expect(await runSettlement(w.deps, 'auc1')).toMatchObject({
      status: 'pending',
      reason: 'capture_pending',
    });
    const captureId = w.server.core.getAuthorization(w.auth('b1')).captures[0]?.id ?? '';

    w.missing(w.auth('b1'), 1);
    expect(await runSettlement(w.deps, 'auc1')).toMatchObject({
      status: 'pending',
      reason: 'capture_pending',
    });
    w.missing(w.auth('b1'), Number.POSITIVE_INFINITY);
    expect(await runSettlement(w.deps, 'auc1')).toMatchObject({ status: 'pending' });
    const waiting = await w.journals.load('auc1');
    expect(waiting?.state).toBe('CAPTURING');
    expect(waiting?.failed).toEqual([]);
    expect(captureCallsOn(w, w.auth('b2'))).toBe(0);
    expect(w.server.core.inspect(w.auth('b2')).voidEffects).toBe(0);

    w.missing(w.auth('b1'), 0);
    w.server.core.completeCapture(captureId);
    const out = await runSettlement(w.deps, 'auc1');
    expect(out.status).toBe('settled');
    if (out.status !== 'settled') return;
    expect(out.journal.winner).toMatchObject({ bidderId: 'b1', captureId, amountCents: 22000 });
    expect(captureCallsOn(w, w.auth('b2'))).toBe(0);
    assertFakeInvariants(w.server.core);
  });
});

function notFound(h: { holdId: string; authId: string }): HoldTruth {
  return {
    holdId: h.holdId,
    authId: h.authId,
    status: 'NOT_FOUND',
    amountCents: 0,
    capturedCents: 0,
    captures: [],
    observedAtMs: 0,
  };
}

function voidNotFound(): PayPalError {
  return new PayPalError({
    kind: 'not_found',
    status: 404,
    name: 'RESOURCE_NOT_FOUND',
    message: 'not found',
    outcome: 'definite',
  });
}

describe('HRD-46 a NOT_FOUND truth in the saga', () => {
  it('does not move to the runner-up after a lost capture answer', async () => {
    const rig = makeRig({ b1: 30000, b2: 25000, b3: 20000 });
    await seed(rig);
    const b1 = rig.auth['b1'] ?? '';
    let gone = false;
    const deps = withGateway(rig, {
      getHoldTruth: async (h) => (gone && h.authId === b1 ? notFound(h) : rig.gw.getHoldTruth(h)),
    });
    rig.core.inject('capture', 'timeout_after_success', b1, 1);
    expect(await runCapturePhase(deps, 'auc1')).toMatchObject({
      status: 'pending',
      reason: 'capture_outcome_unknown',
    });

    gone = true;
    expect(await runCapturePhase(deps, 'auc1')).toMatchObject({
      status: 'pending',
      reason: 'capture_outcome_unknown',
    });
    rig.clock.advance(11 * MIN);
    const out = await runSettlement(deps, 'auc1');
    expect(out).toMatchObject({ status: 'failed', reason: 'capture_outcome_unknown' });
    const j = await rig.journals.load('auc1');
    expect(j?.failed).toEqual([]);
    expect(j?.voids['b1']).toBeUndefined();
    for (const b of ['b2', 'b3']) {
      expect(callsOf(rig, rig.auth[b] ?? '', 'capture')).toBe(0);
      expect(rig.core.inspect(rig.auth[b] ?? '').voidEffects).toBe(0);
    }
    assertFakeInvariants(rig.core);
  });

  it('does not move to the runner-up after a crash right after the capture call', async () => {
    const rig = makeRig({ b1: 30000, b2: 25000, b3: 20000 });
    await seed(rig);
    const b1 = rig.auth['b1'] ?? '';
    let crash = true;
    const deps: SettlementDeps = {
      ...withGateway(rig, {
        getHoldTruth: async (h) =>
          !crash && h.authId === b1 ? notFound(h) : rig.gw.getHoldTruth(h),
      }),
      boundary: (label) => {
        if (crash && label === 'after:capture') {
          crash = false;
          throw new Error('crash');
        }
      },
    };
    await expect(runCapturePhase(deps, 'auc1')).rejects.toThrow('crash');
    const out = await runCapturePhase(deps, 'auc1');
    expect(out).toMatchObject({ status: 'pending', reason: 'capture_outcome_unknown' });
    if (out.status !== 'pending') return;
    expect(out.journal.unknownSince).not.toBeNull();
    expect(out.journal.intent).toMatchObject({ op: 'capture', holdId: 'hold-b1' });
    expect(callsOf(rig, rig.auth['b2'] ?? '', 'capture')).toBe(0);
    assertFakeInvariants(rig.core);
  });

  it('a hold that reads NOT_FOUND after a refused void is not recorded released', async () => {
    const rig = makeRig({ b1: 30000, b2: 25000, b3: 20000 });
    await seed(rig);
    await runCapturePhase(rig.deps, 'auc1');
    const b2 = rig.auth['b2'] ?? '';
    const deps = withGateway(rig, {
      voidAuthorization: async (a, r) => {
        if (a === b2) throw voidNotFound();
        return rig.gw.voidAuthorization(a, r);
      },
      getHoldTruth: async (h) => (h.authId === b2 ? notFound(h) : rig.gw.getHoldTruth(h)),
    });
    const out = await runVoidPhase(deps, 'auc1');
    expect(out).toMatchObject({ status: 'pending', reason: 'void_incomplete' });
    if (out.status !== 'pending') return;
    expect(out.journal.state).toBe('VOIDING');
    expect(out.journal.voids['b2']).toBe('pending');
    expect(out.journal.voids['b3']).toBe('voided');
    assertFakeInvariants(rig.core);
  });

  it('the review release does not record a NOT_FOUND hold as released', async () => {
    const rig = makeRig({ b1: 30000, b2: 25000, b3: 20000 });
    await seed(rig);
    const b3 = rig.auth['b3'] ?? '';
    rig.core.inject('capture', 'timeout_before', rig.auth['b1'] ?? '', 1);
    await runCapturePhase(rig.deps, 'auc1');
    rig.clock.advance(11 * MIN);
    expect(await runCapturePhase(rig.deps, 'auc1')).toMatchObject({ status: 'failed' });

    const deps = withGateway(rig, {
      voidAuthorization: async (a, r) => {
        if (a === b3) throw voidNotFound();
        return rig.gw.voidAuthorization(a, r);
      },
      getHoldTruth: async (h) => (h.authId === b3 ? notFound(h) : rig.gw.getHoldTruth(h)),
    });
    const out = await runVoidPhase({ ...deps, releaseAllReviewHolds: true }, 'auc1');
    expect(out.status).toBe('failed');
    const j = await rig.journals.load('auc1');
    expect(j?.voids['b1']).toBeUndefined();
    expect(j?.voids['b2']).toBe('voided');
    expect(j?.voids['b3']).not.toBe('released');
    expect(rig.core.inspect(rig.auth['b1'] ?? '').voidEffects).toBe(0);
    assertFakeInvariants(rig.core);
  });
});
