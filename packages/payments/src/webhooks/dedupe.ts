import { createHash } from 'node:crypto';
import type { WebhookEventStore } from '../ports.js';
import type { StoredWebhook } from '../types.js';

/**
 * Webhook de-duplication (SPEC 3.7, R-PAY-094). A verified delivery is keyed by
 * PayPal's event `id` and stored with insert-if-absent. The first delivery of an
 * id is new and gets processed once; every later delivery of the same id, in
 * sequence or concurrently, is a duplicate that has no effect and is still
 * answered 200. Atomicity comes from `WebhookEventStore.insertIfAbsent`.
 */

export interface ParsedEvent {
  id: string;
  eventType: string;
  /** The `resource` object, or null when the body has none. */
  resource: Record<string, unknown> | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Reads id, type and resource out of a webhook body. A verified body that is not
 * the expected JSON still gets a stable key (a hash of its bytes) so that it is
 * stored once and acknowledged instead of being redelivered for ever.
 */
export function parseEvent(raw: Buffer | string): ParsedEvent {
  const text = typeof raw === 'string' ? raw : raw.toString('utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  const o = isRecord(parsed) ? parsed : {};
  const id =
    typeof o['id'] === 'string' && o['id'] !== ''
      ? o['id']
      : `raw-${createHash('sha256').update(text).digest('hex').slice(0, 32)}`;
  const eventType =
    typeof o['event_type'] === 'string' && o['event_type'] !== '' ? o['event_type'] : 'UNKNOWN';
  const resource = isRecord(o['resource']) ? o['resource'] : null;
  return { id, eventType, resource };
}

export interface IntakeResult {
  id: string;
  /** True for the first delivery of this event id. */
  isNew: boolean;
  event: StoredWebhook;
}

/** Stores a verified delivery once. The row is durable when this resolves. */
export async function storeEvent(
  events: Pick<WebhookEventStore, 'insertIfAbsent'>,
  rawBody: Buffer,
  receivedAtMs: number,
): Promise<IntakeResult> {
  const p = parseEvent(rawBody);
  const event: StoredWebhook = {
    id: p.id,
    eventType: p.eventType,
    receivedAtMs,
    body: rawBody.toString('utf8'),
  };
  const isNew = await events.insertIfAbsent(event);
  return { id: p.id, isNew, event };
}
