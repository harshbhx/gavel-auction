import { MemoryHoldStore, MemoryWebhookEventStore } from '@gavel/payments';
import type { HoldRecord, HoldTruth, VerifiedWebhook } from '@gavel/payments';
import { describe, expect, it } from 'vitest';
import { WebhookIntake } from '../../src/runtime/webhook-intake';

const hold: HoldRecord = {
  holdId: 'H1',
  auctionId: 'AU1',
  bidderId: 'B1',
  orderId: 'O1',
  authId: 'AUTH-1',
  ceilingCents: 5000,
  status: 'HELD',
  createdAtMs: 0,
};

function rig(): {
  intake: WebhookIntake;
  holds: MemoryHoldStore;
  events: MemoryWebhookEventStore;
  seen: string[];
  failNext: { on: boolean };
  truthStatus: { value: HoldTruth['status'] };
} {
  const holds = new MemoryHoldStore();
  const events = new MemoryWebhookEventStore();
  const seen: string[] = [];
  const failNext = { on: false };
  const truthStatus: { value: HoldTruth['status'] } = { value: 'DENIED' };
  const intake = new WebhookIntake({
    events,
    holds,
    clock: { nowMs: () => 1000 },
    truth: async (h) => ({
      holdId: h.holdId,
      authId: h.authId ?? '',
      status: truthStatus.value,
      amountCents: h.ceilingCents,
      capturedCents: 0,
      captures: [],
      observedAtMs: 1000,
    }),
    listAuctions: async () => ['AU1'],
    onHoldStatus: async (h) => {
      if (failNext.on) {
        failNext.on = false;
        throw new Error('engine unavailable');
      }
      seen.push(`${h.holdId}:${h.status}`);
    },
  });
  return { intake, holds, events, seen, failNext, truthStatus };
}

const denied = {
  headers: {} as unknown as VerifiedWebhook['headers'],
  rawBody: Buffer.from(
    JSON.stringify({
      id: 'WH-1',
      event_type: 'PAYMENT.AUTHORIZATION.DENIED',
      resource: { authId: 'AUTH-1' },
    }),
  ),
  receivedAtMs: 1,
};

describe('webhook intake crash safety (ENG-R3-04)', () => {
  it('tells the engine again when the hold was saved but the engine call did not land', async () => {
    const r = rig();
    await r.holds.put(hold);
    r.failNext.on = true;
    await r.intake.accept(denied);
    expect((await r.holds.get('H1'))?.status).toBe('DENIED');
    expect(r.seen).toEqual([]);
    expect(await r.events.listUnprocessed()).toHaveLength(1);

    expect(await r.intake.sweep()).toBe(1);
    expect(r.seen).toEqual(['H1:DENIED']);
    expect(await r.events.listUnprocessed()).toEqual([]);
  });

  it('writes the status the processor reports, not the one the event names (PAYMENTS-R3-11)', async () => {
    const r = rig();
    await r.holds.put(hold);
    // The event says denied, the processor says the authorization is still live.
    r.truthStatus.value = 'CREATED';
    await r.intake.accept(denied);
    expect((await r.holds.get('H1'))?.status).toBe('HELD');
    expect(r.seen).toEqual([]);
    expect(await r.events.listUnprocessed()).toEqual([]);
  });

  it('keeps a partly captured hold HELD when a capture event arrives (PAYMENTS-R3-11)', async () => {
    const r = rig();
    await r.holds.put(hold);
    r.truthStatus.value = 'PARTIALLY_CAPTURED';
    await r.intake.accept({
      ...denied,
      rawBody: Buffer.from(
        JSON.stringify({
          id: 'WH-2',
          event_type: 'PAYMENT.CAPTURE.COMPLETED',
          resource: { authId: 'AUTH-1' },
        }),
      ),
    });
    expect((await r.holds.get('H1'))?.status).toBe('HELD');
  });

  it('leaves the event for the sweep when the truth read fails (PAYMENTS-R3-11)', async () => {
    const r = rig();
    await r.holds.put(hold);
    const failing = new WebhookIntake({
      events: r.events,
      holds: r.holds,
      clock: { nowMs: () => 1000 },
      truth: async () => {
        throw new Error('paypal unavailable');
      },
      listAuctions: async () => ['AU1'],
      onHoldStatus: async () => undefined,
    });
    await failing.accept(denied);
    expect((await r.holds.get('H1'))?.status).toBe('HELD');
    expect(await r.events.listUnprocessed()).toHaveLength(1);
  });
});

describe('webhook intake unparseable events (PAY-R3-13)', () => {
  it('stores a signed event without id or event_type under a body hash and marks it unparseable', async () => {
    const r = rig();
    const odd: VerifiedWebhook = {
      headers: {} as unknown as VerifiedWebhook['headers'],
      rawBody: Buffer.from(JSON.stringify({ kind: 'new-shape' })),
      receivedAtMs: 5,
    };
    await r.intake.accept(odd);
    await r.intake.accept(odd);
    expect(await r.events.listUnprocessed()).toEqual([]);
    const all = Object.values(r.events.snapshot().events);
    expect(all).toHaveLength(1);
    expect(all[0]?.id.startsWith('unparseable:')).toBe(true);
    expect(all[0]?.result).toBe('unparseable');
  });
});
