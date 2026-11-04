import { describe, expect, it } from 'vitest';
import type { DeliveryOptions } from '../../src/fake/webhooks.js';
import { planDeliveries } from '../../src/fake/webhooks.js';
import { runCapturePhase, invoiceIdFor } from '../../src/saga/capture.js';
import { MemoryHoldStore, MemoryWebhookEventStore } from '../../src/stores/memory.js';
import type { HoldRecord } from '../../src/types.js';
import { createWebhookIntake } from '../../src/webhooks/handler.js';
import { createHoldFinder, processEvent, sweepOrphans } from '../../src/webhooks/orphans.js';
import { makeRig, seed as seedSettlement } from '../saga/rig.js';
import {
  AUCTION,
  START_MS,
  authOf,
  makeWebhookRig,
  mustGet,
  storedFrom,
  type WebhookRig,
} from './rig.js';

/** One auction: h1 is charged 22000, h2 and h3 are released. */
function play(rig: WebhookRig): void {
  rig.core.capture(authOf(rig, 'h1'), 22000, true);
  rig.core.void(authOf(rig, 'h2'));
  rig.core.void(authOf(rig, 'h3'));
}

async function finalStatuses(rig: WebhookRig, opts: DeliveryOptions): Promise<string[]> {
  play(rig);
  const intake = createWebhookIntake({
    events: rig.events,
    audit: rig.deps.audit,
    clock: rig.deps.clock,
    process: (e) => processEvent(rig.deps, e),
  });
  for (const d of planDeliveries(rig.core.events, opts)) {
    const s = storedFrom(d.event);
    await intake.onVerified({
      rawBody: Buffer.from(s.body),
      headers: {},
      receivedAtMs: s.receivedAtMs,
    });
  }
  await intake.drain();
  return Promise.all(['h1', 'h2', 'h3'].map(async (h) => `${h}=${(await mustGet(rig, h)).status}`));
}

const CEILINGS = { h1: 30000, h2: 25000, h3: 20000 };

describe('T-PAY-064 delivery order does not change the outcome', () => {
  it('fifo is the reference', async () => {
    const rig = await makeWebhookRig(CEILINGS);
    expect(await finalStatuses(rig, {})).toEqual(['h1=CAPTURED', 'h2=VOIDED', 'h3=VOIDED']);
  });

  it('reverse, duplicate and shuffle(1..20) give the fifo result', async () => {
    const fifo = await finalStatuses(await makeWebhookRig(CEILINGS), {});
    const modes: DeliveryOptions[] = [
      { order: 'reverse' },
      { duplicate: true },
      { order: 'reverse', duplicate: true },
      ...Array.from({ length: 20 }, (_, i) => ({ order: { shuffle: i + 1 } })),
      ...Array.from({ length: 20 }, (_, i) => ({ order: { shuffle: i + 1 }, duplicate: true })),
    ];
    for (const m of modes) {
      expect(await finalStatuses(await makeWebhookRig(CEILINGS), m), JSON.stringify(m)).toEqual(
        fifo,
      );
    }
  });
});

describe('T-PAY-065 early events', () => {
  it('an event for an unknown hold is parked, then resolved by sweepOrphans once the hold exists', async () => {
    const rig = await makeWebhookRig({ h1: 30000 }, { register: false });
    rig.core.capture(authOf(rig, 'h1'), 22000, true);
    const ev = rig.core.events[0];
    if (ev === undefined) throw new Error('no event');
    const stored = storedFrom(ev, START_MS);
    await rig.events.insertIfAbsent(stored);

    expect(await processEvent(rig.deps, stored)).toBe('parked');
    expect(await rig.events.listOrphans(START_MS + 1)).toHaveLength(1);

    const early = await sweepOrphans({ ...rig.deps, events: rig.events }, START_MS + 60_000);
    expect(early).toMatchObject({ parked: 1, processed: 0, expired: 0 });

    const rec: HoldRecord = {
      holdId: 'h1',
      auctionId: AUCTION,
      bidderId: 'b1',
      orderId: 'ORDER-h1',
      authId: authOf(rig, 'h1'),
      ceilingCents: 30000,
      status: 'HELD',
      createdAtMs: START_MS,
    };
    await rig.holds.put(rec);
    const done = await sweepOrphans({ ...rig.deps, events: rig.events }, START_MS + 120_000);
    expect(done.processed).toBe(1);
    expect((await mustGet(rig, 'h1')).status).toBe('CAPTURED');
    expect(await rig.events.listUnprocessed()).toHaveLength(0);
    expect(await rig.events.listOrphans(START_MS + 120_000)).toHaveLength(0);
  });

  it('an orphan that is still unknown after 10 minutes is closed as orphan_expired', async () => {
    const rig = await makeWebhookRig({ h1: 30000 }, { register: false });
    rig.core.capture(authOf(rig, 'h1'), 22000, true);
    const ev = rig.core.events[0];
    if (ev === undefined) throw new Error('no event');
    const stored = storedFrom(ev, START_MS);
    await rig.events.insertIfAbsent(stored);
    await processEvent(rig.deps, stored);
    const res = await sweepOrphans({ ...rig.deps, events: rig.events }, START_MS + 600_001);
    expect(res.expired).toBe(1);
    expect(await rig.events.listUnprocessed()).toHaveLength(0);
  });

  it('an event stored but never processed (crash) is processed by the sweep', async () => {
    const rig = await makeWebhookRig({ h1: 30000 });
    rig.core.capture(authOf(rig, 'h1'), 22000, true);
    for (const e of rig.core.events) await rig.events.insertIfAbsent(storedFrom(e));
    const res = await sweepOrphans({ ...rig.deps, events: rig.events }, START_MS);
    expect(res.processed).toBe(1);
    expect((await mustGet(rig, 'h1')).status).toBe('CAPTURED');
  });

  it('CAPTURE.COMPLETED before the saga recorded the capture is observed_captured and adopted', async () => {
    const rig = makeRig({ b1: 30000, b2: 25000, b3: 20000 });
    await seedSettlement(rig);
    const holds = new MemoryHoldStore();
    const events = new MemoryWebhookEventStore();
    for (const b of ['b1', 'b2', 'b3']) {
      await holds.put({
        holdId: `hold-${b}`,
        auctionId: 'auc1',
        bidderId: b,
        orderId: `ORDER-${b}`,
        authId: rig.auth[b] ?? '',
        ceilingCents: 30000,
        status: 'HELD',
        createdAtMs: START_MS,
      });
    }
    // The capture happened at PayPal but the saga has not recorded it.
    await rig.gw.capture(rig.auth['b1'] ?? '', {
      amountCents: 22000,
      finalCapture: true,
      invoiceId: invoiceIdFor('auc1', 'hold-b1'),
      requestId: 'earlier-attempt',
    });
    const deps = {
      gateway: rig.gw,
      holds,
      events,
      audit: rig.deps.audit,
      clock: rig.deps.clock,
      findHold: createHoldFinder(holds, async () => ['auc1']),
    };
    const capEvent = rig.core.events.find((e) => e.eventType === 'PAYMENT.CAPTURE.COMPLETED');
    if (capEvent === undefined) throw new Error('no capture event');
    const stored = storedFrom(capEvent, START_MS);
    await events.insertIfAbsent(stored);
    expect(await processEvent(deps, stored)).toBe('observed_captured');
    expect((await holds.get('hold-b1'))?.status).toBe('CAPTURED');

    const out = await runCapturePhase(rig.deps, 'auc1');
    expect(out.status).toBe('captured');
    expect(out.status === 'captured' && out.journal.winner?.amountCents).toBe(22000);
    expect(rig.core.getAuthorization(rig.auth['b1'] ?? '').captures).toHaveLength(1);
  });
});
