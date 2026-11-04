import { MemoryHoldStore, MemoryWebhookEventStore } from '@gavel/payments';
import type { HoldRecord, VerifiedWebhook } from '@gavel/payments';
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
} {
  const holds = new MemoryHoldStore();
  const events = new MemoryWebhookEventStore();
  const seen: string[] = [];
  const failNext = { on: false };
  const intake = new WebhookIntake({
    events,
    holds,
    clock: { nowMs: () => 1000 },
    listAuctions: async () => ['AU1'],
    onHoldStatus: async (h) => {
      if (failNext.on) {
        failNext.on = false;
        throw new Error('engine unavailable');
      }
      seen.push(`${h.holdId}:${h.status}`);
    },
  });
  return { intake, holds, events, seen, failNext };
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
});
