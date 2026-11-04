import { describe, expect, it } from 'vitest';
import { MemoryWebhookEventStore } from '../../src/stores/memory.js';
import type { AuditSink, Clock } from '../../src/ports.js';
import { parseEvent, storeEvent } from '../../src/webhooks/dedupe.js';
import { WebhookHandler, createWebhookIntake } from '../../src/webhooks/handler.js';

const audit: AuditSink = { append: async () => undefined };
const clock: Clock = { nowMs: () => 1_800_000_000_000 };
const body = (id: string): Buffer =>
  Buffer.from(
    JSON.stringify({ id, event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { authId: 'A1' } }),
  );

function build(): {
  events: MemoryWebhookEventStore;
  effects: string[];
  handler: WebhookHandler;
  drain: () => Promise<void>;
} {
  const events = new MemoryWebhookEventStore();
  const effects: string[] = [];
  const intake = createWebhookIntake({
    events,
    audit,
    clock,
    process: async (e) => void effects.push(e.id),
  });
  const handler = new WebhookHandler({
    verifier: { verifyWebhook: async () => ({ ok: true }) },
    audit,
    clock,
    onVerified: intake.onVerified,
  });
  return { events, effects, handler, drain: () => intake.drain() };
}

describe('T-PAY-062 webhook de-duplication', () => {
  it('stores the same event id once and answers 200 both times', async () => {
    const { events, effects, handler, drain } = build();
    expect(await handler.handle(body('WH-1'), {})).toEqual({ status: 200 });
    expect(await handler.handle(body('WH-1'), {})).toEqual({ status: 200 });
    await drain();
    expect(effects).toEqual(['WH-1']);
    expect(await events.listUnprocessed()).toHaveLength(1);
  });

  it('50 concurrent deliveries of one id give one insert, one effect and all 200', async () => {
    const { events, effects, handler, drain } = build();
    const res = await Promise.all(
      Array.from({ length: 50 }, () => handler.handle(body('WH-2'), {})),
    );
    await drain();
    expect(res.every((r) => r.status === 200)).toBe(true);
    expect(effects).toEqual(['WH-2']);
    expect(await events.listUnprocessed()).toHaveLength(1);
  });

  it('different ids are independent', async () => {
    const { effects, handler, drain } = build();
    await Promise.all(['WH-3', 'WH-4', 'WH-3'].map((id) => handler.handle(body(id), {})));
    await drain();
    expect([...effects].sort()).toEqual(['WH-3', 'WH-4']);
  });

  it('insertIfAbsent reports new then duplicate', async () => {
    const events = new MemoryWebhookEventStore();
    expect((await storeEvent(events, body('WH-5'), 1)).isNew).toBe(true);
    expect((await storeEvent(events, body('WH-5'), 2)).isNew).toBe(false);
  });

  it('a body without an id gets a stable key from its bytes', async () => {
    const events = new MemoryWebhookEventStore();
    const raw = Buffer.from('not json at all');
    const a = await storeEvent(events, raw, 1);
    const b = await storeEvent(events, raw, 2);
    expect(a.id).toBe(b.id);
    expect(a.id.startsWith('raw-')).toBe(true);
    expect(b.isNew).toBe(false);
    expect(parseEvent(raw).eventType).toBe('UNKNOWN');
  });
});
