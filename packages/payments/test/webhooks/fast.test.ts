import { describe, expect, it } from 'vitest';
import type { WebhookEventStore } from '../../src/ports.js';
import { MemoryWebhookEventStore } from '../../src/stores/memory.js';
import type { StoredWebhook } from '../../src/types.js';
import { WebhookHandler, createWebhookIntake } from '../../src/webhooks/handler.js';
import { processEvent } from '../../src/webhooks/orphans.js';
import { authOf, makeWebhookRig, mustGet, storedFrom } from './rig.js';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('T-PAY-068 handler responsiveness', () => {
  it('answers 200 under 300 ms with the event stored while the truth check takes seconds', async () => {
    let releaseTruth: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      releaseTruth = r;
    });
    const rig = await makeWebhookRig(
      { h1: 30000 },
      {
        gateway: {
          getHoldTruth: async (h) => {
            await gate; // stands in for a 3 s truth check
            return {
              holdId: h.holdId,
              authId: h.authId,
              status: 'CAPTURED',
              amountCents: 30000,
              capturedCents: 22000,
              captures: [],
              observedAtMs: 0,
            };
          },
        },
      },
    );
    rig.core.capture(authOf(rig, 'h1'), 22000, true);
    const ev = rig.core.events[0];
    if (ev === undefined) throw new Error('no event');
    const row = storedFrom(ev);

    const inner = new MemoryWebhookEventStore();
    const slowStore: Pick<WebhookEventStore, 'insertIfAbsent'> = {
      insertIfAbsent: async (e: StoredWebhook) => {
        await sleep(100); // store latency
        return inner.insertIfAbsent(e);
      },
    };
    const intake = createWebhookIntake({
      events: slowStore,
      audit: rig.deps.audit,
      clock: rig.deps.clock,
      process: (e) => processEvent({ ...rig.deps, events: inner }, e),
    });
    const handler = new WebhookHandler({
      verifier: { verifyWebhook: async () => ({ ok: true }) },
      audit: rig.deps.audit,
      clock: rig.deps.clock,
      onVerified: intake.onVerified,
    });

    const t0 = performance.now();
    const res = await handler.handle(Buffer.from(row.body), {});
    const took = performance.now() - t0;
    expect(res).toEqual({ status: 200 });
    expect(took).toBeLessThan(300);
    expect(await inner.listUnprocessed()).toHaveLength(1);
    expect((await mustGet(rig, 'h1')).status).toBe('HELD');

    releaseTruth();
    await intake.drain();
    expect((await mustGet(rig, 'h1')).status).toBe('CAPTURED');
    expect(await inner.listUnprocessed()).toHaveLength(0);
  });

  it('a processing failure does not change the answer and leaves the event for the sweep', async () => {
    const rig = await makeWebhookRig({ h1: 30000 });
    const inner = new MemoryWebhookEventStore();
    const intake = createWebhookIntake({
      events: inner,
      audit: rig.deps.audit,
      clock: rig.deps.clock,
      process: async () => {
        throw new Error('boom');
      },
    });
    const body = Buffer.from(JSON.stringify({ id: 'WH-9', event_type: 'X', resource: {} }));
    await intake.onVerified({ rawBody: body, headers: {}, receivedAtMs: 1 });
    await intake.drain();
    expect(await inner.listUnprocessed()).toHaveLength(1);
    expect(rig.audits.some((a) => a.label === 'webhook_process_failed')).toBe(true);
  });
});
