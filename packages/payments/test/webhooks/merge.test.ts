import { describe, expect, it } from 'vitest';
import { PayPalError } from '../../src/errors.js';
import type { HoldStatus } from '../../src/types.js';
import { mergeStatus, observeHold, toHint, HINT_KINDS } from '../../src/webhooks/merge.js';
import { processEvent } from '../../src/webhooks/orphans.js';
import { authOf, makeWebhookRig, mustGet, storedFrom } from './rig.js';

describe('toHint', () => {
  it('maps every handled event type and keeps ids', () => {
    expect(toHint('PAYMENT.AUTHORIZATION.CREATED', { id: 'AUTH-1' })).toMatchObject({
      kind: 'authorization_created',
      authId: 'AUTH-1',
    });
    expect(
      toHint('PAYMENT.CAPTURE.COMPLETED', { authId: 'AUTH-1', captureId: 'CAP-1' }),
    ).toMatchObject({
      kind: 'capture_completed',
      authId: 'AUTH-1',
      captureId: 'CAP-1',
    });
    expect(
      toHint('PAYMENT.CAPTURE.PENDING', {
        id: 'CAP-2',
        amount: { value: '9.99', currency_code: 'USD' },
        supplementary_data: { related_ids: { authorization_id: 'AUTH-2', order_id: 'O-2' } },
      }),
    ).toMatchObject({
      kind: 'capture_pending',
      captureId: 'CAP-2',
      authId: 'AUTH-2',
      orderId: 'O-2',
      claimedCents: 999,
    });
    expect(toHint('CHECKOUT.ORDER.APPROVED', { orderId: 'O-1' })).toMatchObject({
      kind: 'order_approved',
      orderId: 'O-1',
    });
    expect(toHint('PAYMENT.CAPTURE.DENIED', {})).toMatchObject({ kind: 'capture_denied' });
    expect(toHint('PAYMENT.AUTHORIZATION.VOIDED', { authId: 'A' })?.kind).toBe(
      'authorization_voided',
    );
    expect(HINT_KINDS).toHaveLength(6);
  });

  it('T-PAY-067 returns null for an unknown type', () => {
    expect(toHint('BILLING.SUBSCRIPTION.CREATED', { id: 'X' })).toBeNull();
  });
});

describe('mergeStatus', () => {
  const live: HoldStatus[] = ['PENDING_APPROVAL', 'HELD', 'CAPTURED'];
  const finals: HoldStatus[] = ['VOIDED', 'EXPIRED', 'DENIED'];

  it('moves up the rank and never down', () => {
    expect(mergeStatus('PENDING_APPROVAL', 'HELD')).toEqual({ apply: true, status: 'HELD' });
    expect(mergeStatus('HELD', 'CAPTURED')).toEqual({ apply: true, status: 'CAPTURED' });
    expect(mergeStatus('HELD', 'PENDING_APPROVAL')).toEqual({ apply: false, reason: 'stale' });
  });

  it('a live status moves to a final one', () => {
    for (const f of finals) {
      expect(mergeStatus('HELD', f)).toEqual({ apply: true, status: f });
      expect(mergeStatus('PENDING_APPROVAL', f)).toEqual({ apply: true, status: f });
    }
  });

  it('a final status is not left for a live one', () => {
    for (const f of finals) {
      expect(mergeStatus(f, 'HELD')).toEqual({ apply: false, reason: 'stale' });
    }
  });

  it('CAPTURED against a final status, or two different finals, is a conflict', () => {
    for (const f of finals) {
      expect(mergeStatus('CAPTURED', f)).toEqual({ apply: false, reason: 'conflict' });
      expect(mergeStatus(f, 'CAPTURED')).toEqual({ apply: false, reason: 'conflict' });
    }
    expect(mergeStatus('VOIDED', 'DENIED')).toEqual({ apply: false, reason: 'conflict' });
  });

  it('same status and unobserved status change nothing; unknown adopts anything observed', () => {
    for (const s of [...live, ...finals])
      expect(mergeStatus(s, s)).toEqual({ apply: false, reason: 'same' });
    expect(mergeStatus('HELD', 'UNKNOWN')).toEqual({ apply: false, reason: 'unobserved' });
    expect(mergeStatus('UNKNOWN', 'VOIDED')).toEqual({ apply: true, status: 'VOIDED' });
  });
});

describe('observeHold', () => {
  it('T-PAY-063 an event claiming 999 against a truth of 220 uses the truth and reports AMOUNT_MISMATCH', async () => {
    const rig = await makeWebhookRig({ h1: 30000 });
    rig.core.capture(authOf(rig, 'h1'), 220, true);
    const record = await mustGet(rig, 'h1');
    const r = await observeHold(rig.deps, record, {
      kind: 'capture_completed',
      authId: authOf(rig, 'h1'),
      claimedCents: 999,
    });
    expect(r.capturedCents).toBe(220);
    expect(r.status).toBe('CAPTURED');
    expect(r.findings).toEqual(['AMOUNT_MISMATCH']);
    expect(rig.audits.some((a) => a.label === 'AMOUNT_MISMATCH' && a.to === '220')).toBe(true);
    expect((await rig.holds.get('h1'))?.status).toBe('CAPTURED');
  });

  it('no finding when the claim equals the truth', async () => {
    const rig = await makeWebhookRig({ h1: 30000 });
    rig.core.capture(authOf(rig, 'h1'), 220, true);
    const record = await mustGet(rig, 'h1');
    const r = await observeHold(rig.deps, record, {
      kind: 'capture_completed',
      claimedCents: 220,
    });
    expect(r.findings).toEqual([]);
  });

  it('T-PAY-066 CAPTURED then a VOIDED report is not applied and audits status_conflict', async () => {
    const rig = await makeWebhookRig({ h1: 30000 });
    const authId = authOf(rig, 'h1');
    rig.core.capture(authId, 220, true);
    const ev = rig.core.events;
    for (const e of ev) {
      await rig.events.insertIfAbsent(storedFrom(e));
      await processEvent(rig.deps, storedFrom(e));
    }
    expect((await rig.holds.get('h1'))?.status).toBe('CAPTURED');
    // PayPal now reports a voided authorization (a late, contradictory fact).
    const voided = {
      ...rig.deps,
      gateway: {
        getHoldTruth: async () => ({
          holdId: 'h1',
          authId,
          status: 'VOIDED' as const,
          amountCents: 30000,
          capturedCents: 0,
          captures: [],
          observedAtMs: 0,
        }),
      },
    };
    const late = {
      id: 'WH-late',
      eventType: 'PAYMENT.AUTHORIZATION.VOIDED',
      receivedAtMs: 1,
      body: JSON.stringify({
        id: 'WH-late',
        event_type: 'PAYMENT.AUTHORIZATION.VOIDED',
        resource: { authId },
      }),
    };
    await rig.events.insertIfAbsent(late);
    const res = await processEvent(voided, late);
    expect(res).toBe('status_conflict');
    expect((await rig.holds.get('h1'))?.status).toBe('CAPTURED');
    expect(rig.audits.filter((a) => a.label === 'status_conflict')).toHaveLength(1);
  });

  it('a truth read that fails with a PayPal error is unobservable and changes nothing', async () => {
    const rig = await makeWebhookRig(
      { h1: 30000 },
      {
        gateway: {
          getHoldTruth: async () => {
            throw new PayPalError({
              kind: 'server_error',
              status: 500,
              name: 'X',
              message: 'down',
              outcome: 'unknown',
            });
          },
        },
      },
    );
    const record = await mustGet(rig, 'h1');
    const r = await observeHold(rig.deps, record, { kind: 'capture_completed' });
    expect(r.outcome).toBe('unobservable');
    expect((await rig.holds.get('h1'))?.status).toBe('HELD');
  });
});
