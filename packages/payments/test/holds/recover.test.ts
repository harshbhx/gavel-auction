import { describe, expect, it } from 'vitest';
import { FakeClock, FakePayPalCore } from '../../src/fake/core.js';
import { FakeGateway } from '../../src/fake/gateway.js';
import { assertFakeInvariants } from '../../src/fake/invariants.js';
import {
  flagStaleHolds,
  isStale,
  recoverOrder,
  sweepAuction,
  sweepStalePending,
  type RecoverDeps,
} from '../../src/holds/recover.js';
import { HoldService } from '../../src/holds/service.js';
import { runCapturePhase } from '../../src/saga/capture.js';
import { createSettlement } from '../../src/saga/create.js';
import { MemoryHoldStore, MemoryJournalStore } from '../../src/stores/memory.js';
import type { PaymentAudit, SettlementPlan } from '../../src/types.js';
import { FRESH_HOLDS } from '../helpers/age.js';

const START_MS = 1_800_000_000_000;
const PRESETS = [5000, 15000, 25000];
const HOUR = 3_600_000;
const MAX_AGE = 2 * HOUR;

function makeRig(open = true) {
  const clock = new FakeClock(START_MS);
  const core = new FakePayPalCore({ clock });
  const gateway = new FakeGateway(core);
  const holds = new MemoryHoldStore();
  const audits: PaymentAudit[] = [];
  const audit = { append: async (e: PaymentAudit) => void audits.push(e) };
  const now = { nowMs: () => clock.nowMs() };
  let n = 0;
  const service = new HoldService({
    gateway,
    holds,
    audit,
    clock: now,
    maxCeilingCents: 25000,
    newId: () => `hold-${(n += 1)}`,
  });
  const state = { open };
  const deps: RecoverDeps = {
    gateway,
    holds,
    audit,
    clock: now,
    service,
    isAuctionOpen: async () => state.open,
  };
  return { clock, core, gateway, holds, audits, audit, now, service, deps, state };
}

type Rig = ReturnType<typeof makeRig>;

async function pendingOrder(
  rig: Rig,
  bidderId = 'b1',
): Promise<{ holdId: string; orderId: string }> {
  return rig.service.createHoldOrder({
    auctionId: 'a1',
    bidderId,
    ceilingCents: 15000,
    presetsCents: PRESETS,
  });
}

const authorizes = (rig: Rig) => rig.core.calls.filter((c) => c.op === 'authorize').length;

describe('T-PAY-026 recover an approved but unauthorized order', () => {
  it('authorizes it while the auction is open', async () => {
    const rig = makeRig(true);
    const { holdId, orderId } = await pendingOrder(rig);
    rig.core.approveOrder(orderId);
    const out = await recoverOrder(rig.deps, { auctionId: 'a1', orderId });
    expect(out).toMatchObject({ status: 'authorized', hold: { holdId, status: 'HELD' } });
    const stored = await rig.holds.get(holdId);
    expect(stored?.status).toBe('HELD');
    expect(stored?.authId).toBeDefined();
    expect(authorizes(rig)).toBe(1);
    assertFakeInvariants(rig.core);
  });

  it('abandons it when the auction is closed, with only a read of the order', async () => {
    const rig = makeRig(false);
    const { holdId, orderId } = await pendingOrder(rig);
    rig.core.approveOrder(orderId);
    rig.core.calls.length = 0;
    const out = await recoverOrder(rig.deps, { auctionId: 'a1', orderId });
    expect(out).toEqual({ status: 'abandoned' });
    expect((await rig.holds.get(holdId))?.status).toBe('EXPIRED');
    expect(rig.core.calls.filter((c) => c.op !== 'get')).toHaveLength(0);
    expect(rig.audits.at(-1)).toMatchObject({ holdId, to: 'EXPIRED', label: 'hold_abandoned' });
  });

  it('leaves an order the buyer has not approved', async () => {
    const rig = makeRig(true);
    const { holdId, orderId } = await pendingOrder(rig);
    expect(await recoverOrder(rig.deps, { auctionId: 'a1', orderId })).toEqual({
      status: 'not_approved',
    });
    expect((await rig.holds.get(holdId))?.status).toBe('PENDING_APPROVAL');
    expect(authorizes(rig)).toBe(0);
  });

  it('is idempotent: a second recover answers already_held with one authorize', async () => {
    const rig = makeRig(true);
    const { holdId, orderId } = await pendingOrder(rig);
    rig.core.approveOrder(orderId);
    await recoverOrder(rig.deps, { auctionId: 'a1', orderId });
    expect(await recoverOrder(rig.deps, { auctionId: 'a1', orderId })).toEqual({
      status: 'already_held',
      holdId,
    });
    expect(authorizes(rig)).toBe(1);
  });

  it('survives an authorize whose answer was lost: one authorization', async () => {
    const rig = makeRig(true);
    const { orderId } = await pendingOrder(rig);
    rig.core.approveOrder(orderId);
    rig.core.inject('authorize', 'timeout_after_success');
    const out = await recoverOrder(rig.deps, { auctionId: 'a1', orderId });
    expect(out.status).toBe('authorized');
    expect(rig.core.getOrder(orderId).authId).toBeDefined();
    assertFakeInvariants(rig.core);
  });

  it('reports unavailable, and keeps the hold pending, when PayPal is down', async () => {
    const rig = makeRig(true);
    const { holdId, orderId } = await pendingOrder(rig);
    rig.core.approveOrder(orderId);
    rig.core.inject('get', 'http_500', null, 1);
    expect(await recoverOrder(rig.deps, { auctionId: 'a1', orderId })).toEqual({
      status: 'unavailable',
    });
    expect((await rig.holds.get(holdId))?.status).toBe('PENDING_APPROVAL');
    // A later sweep finishes the job.
    const swept = await sweepAuction(rig.deps, 'a1');
    expect(swept).toEqual([{ holdId, result: expect.objectContaining({ status: 'authorized' }) }]);
  });

  it('answers unknown_order for an order the store does not have', async () => {
    const rig = makeRig(true);
    expect(await recoverOrder(rig.deps, { auctionId: 'a1', orderId: 'nope' })).toEqual({
      status: 'unknown_order',
    });
  });

  it('a sweep handles every pending order of the auction in hold id order', async () => {
    const rig = makeRig(true);
    const a = await pendingOrder(rig, 'b1');
    const b = await pendingOrder(rig, 'b2');
    rig.core.approveOrder(b.orderId);
    const swept = await sweepAuction(rig.deps, 'a1');
    expect(swept.map((s) => [s.holdId, s.result.status])).toEqual([
      [a.holdId, 'not_approved'],
      [b.holdId, 'authorized'],
    ]);
  });
});

describe('T-PAY-023 stale holds', () => {
  it('isStale is strict', () => {
    expect(isStale(0, MAX_AGE, MAX_AGE)).toBe(false);
    expect(isStale(0, MAX_AGE + 1, MAX_AGE)).toBe(true);
  });

  async function heldHold(rig: Rig, bidderId = 'b1') {
    const { holdId, orderId } = await pendingOrder(rig, bidderId);
    rig.core.approveOrder(orderId);
    await rig.service.completeApproval({ holdId, orderId });
    return holdId;
  }

  it('flags a hold of 2h01m, audits it once, and the capture is still attempted', async () => {
    const rig = makeRig(true);
    const holdId = await heldHold(rig);
    rig.clock.advance(2 * HOUR + 60_000);

    const stale = { holds: rig.holds, audit: rig.audit, clock: rig.now, holdMaxAgeMs: MAX_AGE };
    expect(await flagStaleHolds(stale, 'a1')).toEqual([holdId]);
    expect((await rig.holds.get(holdId))?.stale).toBe(true);
    const entries = rig.audits.filter((a) => a.kind === 'stale_hold');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ holdId, auctionId: 'a1' });
    // Flagging again changes nothing.
    expect(await flagStaleHolds(stale, 'a1')).toEqual([]);
    expect(rig.audits.filter((a) => a.kind === 'stale_hold')).toHaveLength(1);

    // The settlement starts and the stale hold is captured all the same.
    const record = await rig.holds.get(holdId);
    const plan: SettlementPlan = {
      auctionId: 'a1',
      reserveCents: 5000,
      candidates: [{ bidderId: 'b1', priceCents: 10000 }],
      holds: {
        b1: {
          holdId,
          authId: record?.authId ?? '',
          ceilingCents: 15000,
          createdAtMs: record?.createdAtMs ?? 0,
        },
      },
    };
    const journals = new MemoryJournalStore();
    const created = await createSettlement(
      { journals, clock: rig.now, holdMaxAgeMs: MAX_AGE, audit: FRESH_HOLDS.audit },
      plan,
    );
    expect(created.journal.holds['b1']?.stale).toBe(true);
    const out = await runCapturePhase(
      { journals, gateway: rig.gateway, audit: rig.audit, clock: rig.now },
      'a1',
    );
    expect(out.status).toBe('captured');
    expect(rig.core.calls.some((c) => c.op === 'capture')).toBe(true);
    assertFakeInvariants(rig.core);
  });

  it('does not flag a hold of exactly the maximum age, nor one that is not held', async () => {
    const rig = makeRig(true);
    const holdId = await heldHold(rig, 'b1');
    await pendingOrder(rig, 'b2');
    rig.clock.advance(MAX_AGE);
    const stale = { holds: rig.holds, audit: rig.audit, clock: rig.now, holdMaxAgeMs: MAX_AGE };
    expect(await flagStaleHolds(stale, 'a1')).toEqual([]);
    rig.clock.advance(1);
    expect(await flagStaleHolds(stale, 'a1')).toEqual([holdId]);
  });
});

describe('R8-P05 an authorization created before a crash is not left live', () => {
  /** PayPal authorized the order, but the record never got the authorization id. */
  async function crashedAfterAuthorize(rig: Rig): Promise<{ holdId: string; authId: string }> {
    const { holdId, orderId } = await pendingOrder(rig);
    rig.core.approveOrder(orderId);
    const a = rig.core.authorizeOrder(orderId, 'lost-authorize');
    return { holdId, authId: a.authId };
  }

  it('voids it when the auction is closed and keeps its id on the expired record', async () => {
    const rig = makeRig(false);
    const { holdId, authId } = await crashedAfterAuthorize(rig);
    rig.clock.advance(10 * 60_000);
    const out = await sweepStalePending(rig.deps, 'a1', 5 * 60_000);
    expect(out).toEqual([{ holdId, result: { status: 'abandoned' } }]);
    const rec = await rig.holds.get(holdId);
    expect(rec).toMatchObject({ status: 'EXPIRED', authId });
    expect(rig.core.inspect(authId).voidEffects).toBe(1);
    assertFakeInvariants(rig.core);
  });

  it('audits the void of the authorization it finds (RT4-saga-04)', async () => {
    const rig = makeRig(false);
    const { holdId } = await crashedAfterAuthorize(rig);
    rig.clock.advance(10 * 60_000);
    await sweepStalePending(rig.deps, 'a1', 5 * 60_000);
    const calls = rig.audits.filter((a) => a.kind === 'paypal_call' && a.op === 'void');
    expect(calls).toEqual([
      expect.objectContaining({
        auctionId: 'a1',
        holdId,
        op: 'void',
        outcome: 'definite',
        label: 'ok',
        requestId: expect.stringMatching(/\S/),
      }),
    ]);
    // The row of the call comes before the state change it led to.
    const kinds = rig.audits.filter((a) => a.holdId === holdId).map((a) => a.kind);
    expect(kinds.slice(-2)).toEqual(['paypal_call', 'state_change']);
  });

  it('adopts it while the auction is open, so the hold is tracked', async () => {
    const rig = makeRig(true);
    const { holdId, authId } = await crashedAfterAuthorize(rig);
    rig.clock.advance(10 * 60_000);
    await sweepStalePending(rig.deps, 'a1', 5 * 60_000);
    expect(await rig.holds.get(holdId)).toMatchObject({ status: 'HELD', authId });
    expect(rig.core.inspect(authId).voidEffects).toBe(0);
  });

  it('leaves a young pending hold and one whose order has no authorization', async () => {
    const rig = makeRig(false);
    const young = await crashedAfterAuthorize(rig);
    const none = await pendingOrder(rig, 'b2');
    const out = await sweepStalePending(rig.deps, 'a1', 5 * 60_000);
    expect(out).toEqual([]);
    expect((await rig.holds.get(young.holdId))?.status).toBe('PENDING_APPROVAL');
    rig.clock.advance(10 * 60_000);
    const later = await sweepStalePending(rig.deps, 'a1', 5 * 60_000);
    expect(later.map((x) => x.holdId)).toEqual([young.holdId]);
    expect((await rig.holds.get(none.holdId))?.status).toBe('PENDING_APPROVAL');
  });
});
