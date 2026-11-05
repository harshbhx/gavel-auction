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

describe('hold writes use the record as it is now (R9-M05)', () => {
  it('does not overwrite a write that landed during the truth read', async () => {
    const holds = new MemoryHoldStore();
    await holds.put(hold);
    const intake = new WebhookIntake({
      events: new MemoryWebhookEventStore(),
      holds,
      clock: { nowMs: () => 1000 },
      truth: async (h) => {
        // A newer write for the same hold lands while PayPal is being read.
        await holds.put({ ...h, ceilingCents: 7777 });
        return {
          holdId: h.holdId,
          authId: h.authId ?? '',
          status: 'DENIED',
          amountCents: h.ceilingCents,
          capturedCents: 0,
          captures: [],
          observedAtMs: 1000,
        };
      },
      listAuctions: async () => ['AU1'],
      onHoldStatus: async () => undefined,
    });
    await intake.accept(denied);
    const after = await holds.get('H1');
    expect(after?.status).toBe('DENIED');
    expect(after?.ceilingCents).toBe(7777);
  });
});

describe('capture events are hints for the settlement (R11-O03)', () => {
  function pendingIntake(hints: string[]): { intake: WebhookIntake; holds: MemoryHoldStore } {
    const holds = new MemoryHoldStore();
    const intake = new WebhookIntake({
      events: new MemoryWebhookEventStore(),
      holds,
      clock: { nowMs: () => 1000 },
      // PayPal lists the only capture of the hold as PENDING.
      truth: async (h) => ({
        holdId: h.holdId,
        authId: h.authId ?? '',
        status: 'CAPTURED',
        amountCents: h.ceilingCents,
        capturedCents: 3000,
        captures: [{ captureId: 'C1', amountCents: 3000, final: true, pending: true }],
        observedAtMs: 1000,
      }),
      listAuctions: async () => ['AU1'],
      onHoldStatus: async () => undefined,
      onCaptureHint: async (h) => {
        hints.push(h.holdId);
      },
    });
    return { intake, holds };
  }

  function event(id: string, type: string): VerifiedWebhook {
    return {
      ...denied,
      rawBody: Buffer.from(
        JSON.stringify({ id, event_type: type, resource: { authId: 'AUTH-1', captureId: 'C1' } }),
      ),
    };
  }

  it('runs the settlement again for every capture event of a known hold', async () => {
    const hints: string[] = [];
    const { intake, holds } = pendingIntake(hints);
    await holds.put(hold);
    await intake.accept(event('WH-P', 'PAYMENT.CAPTURE.PENDING'));
    await intake.accept(event('WH-D', 'PAYMENT.CAPTURE.DENIED'));
    await intake.accept(event('WH-X', 'PAYMENT.CAPTURE.DECLINED'));
    await intake.accept(event('WH-C', 'PAYMENT.CAPTURE.COMPLETED'));
    expect(hints).toEqual(['H1', 'H1', 'H1', 'H1']);
  });

  it('does not mark a hold captured while its capture is pending', async () => {
    const { intake, holds } = pendingIntake([]);
    await holds.put(hold);
    await intake.accept(event('WH-C2', 'PAYMENT.CAPTURE.COMPLETED'));
    expect((await holds.get('H1'))?.status).toBe('HELD');
  });
});
