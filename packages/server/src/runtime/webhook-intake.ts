import type {
  Clock,
  HoldRecord,
  HoldStatus,
  HoldStore,
  HoldTruth,
  StoredWebhook,
  VerifiedWebhook,
  WebhookEventStore,
} from '@gavel/payments';

/**
 * What a verified PayPal event does to the hold records (SPEC 3.7). The webhook
 * handler has already checked the signature; this stores the event durably, then
 * applies it. An event whose hold is not known yet is parked and retried by the
 * sweep. Events are applied at most once per event id, and a status never moves
 * backwards: only a HELD hold changes, so a late or repeated delivery is harmless.
 */

export interface WebhookIntakeDeps {
  events: WebhookEventStore;
  holds: HoldStore;
  clock: Clock;
  /** Every auction id the service knows, to find the hold behind an authorization id. */
  listAuctions(): Promise<string[]>;
  /**
   * Reads the hold's state at the processor. A webhook is only a hint (R-PAY-095): the
   * status written to the record comes from this read, never from the event body.
   */
  truth(hold: HoldRecord): Promise<HoldTruth>;
  /** Called after a hold changed status because of an event. */
  onHoldStatus(hold: HoldRecord): Promise<void>;
  /** How long an event for an unknown hold is retried. Default 10 minutes. */
  orphanWindowMs?: number;
}

export const DEFAULT_ORPHAN_WINDOW_MS = 600_000;

type Json = Record<string, unknown>;

function asObject(v: unknown): Json | undefined {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : undefined;
}

interface ParsedEvent {
  id: string;
  eventType: string;
  resource: Json;
}

function parse(body: string): ParsedEvent | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return undefined;
  }
  const o = asObject(raw);
  if (o === undefined) return undefined;
  const id = o['id'];
  const eventType = o['event_type'];
  if (typeof id !== 'string' || id === '' || typeof eventType !== 'string') return undefined;
  return { id, eventType, resource: asObject(o['resource']) ?? {} };
}

/** The authorization an event is about: the sandbox shapes and the live PayPal shape. */
export function authIdOf(e: { eventType: string; resource: Json }): string | undefined {
  const direct = e.resource['authId'];
  if (typeof direct === 'string') return direct;
  const related = asObject(asObject(e.resource['supplementary_data'])?.['related_ids']);
  const fromRelated = related?.['authorization_id'];
  if (typeof fromRelated === 'string') return fromRelated;
  const id = e.resource['id'];
  return e.eventType.startsWith('PAYMENT.AUTHORIZATION.') && typeof id === 'string'
    ? id
    : undefined;
}

/** True for the event types that can change a hold; the new status comes from the truth read. */
function changesHold(e: ParsedEvent): boolean {
  return (
    e.eventType === 'PAYMENT.AUTHORIZATION.VOIDED' ||
    e.eventType === 'PAYMENT.AUTHORIZATION.DENIED' ||
    e.eventType === 'PAYMENT.CAPTURE.COMPLETED'
  );
}

/** The hold status a processor state means, or undefined while the hold is still live. */
function statusFromTruth(truth: HoldTruth): HoldStatus | undefined {
  switch (truth.status) {
    case 'VOIDED':
      return 'VOIDED';
    case 'EXPIRED':
      return 'EXPIRED';
    case 'DENIED':
      return 'DENIED';
    case 'CAPTURED':
      return 'CAPTURED';
    default:
      // CREATED, PENDING, PARTIALLY_CAPTURED and NOT_FOUND: nothing is final yet.
      return undefined;
  }
}

export class WebhookIntake {
  private readonly orphanWindowMs: number;

  constructor(private readonly deps: WebhookIntakeDeps) {
    this.orphanWindowMs = deps.orphanWindowMs ?? DEFAULT_ORPHAN_WINDOW_MS;
  }

  /**
   * Stores a verified delivery, then applies it. Throws only when the event could not
   * be stored (the handler answers 503 and PayPal sends it again); a failure while
   * applying leaves the stored event for the sweep.
   */
  async accept(delivery: VerifiedWebhook): Promise<void> {
    const body = delivery.rawBody.toString('utf8');
    const event = parse(body);
    if (event === undefined) return;
    const stored: StoredWebhook = {
      id: event.id,
      eventType: event.eventType,
      receivedAtMs: delivery.receivedAtMs,
      body,
    };
    if (!(await this.deps.events.insertIfAbsent(stored))) return;
    try {
      await this.apply(stored);
    } catch {
      // Stored and not marked processed: the sweep applies it again.
    }
  }

  /** Applies every stored event that has no result yet. Returns how many reached a result. */
  async sweep(): Promise<number> {
    let done = 0;
    for (const stored of await this.deps.events.listUnprocessed()) {
      try {
        if ((await this.apply(stored)) !== 'parked') done += 1;
      } catch {
        // Leave it for the next sweep.
      }
    }
    return done;
  }

  private async apply(stored: StoredWebhook): Promise<'processed' | 'parked'> {
    const event = parse(stored.body);
    if (event === undefined || !changesHold(event)) {
      await this.deps.events.markProcessed(stored.id, 'ignored');
      return 'processed';
    }
    const authId = authIdOf(event);
    const hold = authId === undefined ? undefined : await this.findHold(authId);
    if (hold === undefined) {
      const now = this.deps.clock.nowMs();
      const until = stored.parkedUntilMs ?? now + this.orphanWindowMs;
      if (stored.parkedUntilMs !== undefined && stored.parkedUntilMs <= now) {
        await this.deps.events.markProcessed(stored.id, 'orphan_dropped');
        return 'processed';
      }
      if (stored.parkedUntilMs === undefined) await this.deps.events.parkOrphan(stored.id, until);
      return 'parked';
    }
    if (hold.status !== 'HELD') {
      // The status may have been saved by an earlier attempt that died before the engine
      // heard about it. onHoldStatus is safe to repeat, so run it again before the result
      // is recorded (R-ENG-044).
      await this.deps.onHoldStatus(hold);
      await this.deps.events.markProcessed(stored.id, `unchanged:${hold.status}`);
      return 'processed';
    }
    // A read that fails throws: the event stays stored and the sweep applies it again.
    const target = statusFromTruth(await this.deps.truth(hold));
    if (target === undefined) {
      await this.deps.events.markProcessed(stored.id, 'unchanged:live');
      return 'processed';
    }
    const next: HoldRecord = { ...hold, status: target };
    await this.deps.holds.put(next);
    await this.deps.onHoldStatus(next);
    await this.deps.events.markProcessed(stored.id, `hold:${target}`);
    return 'processed';
  }

  private async findHold(authId: string): Promise<HoldRecord | undefined> {
    for (const auctionId of await this.deps.listAuctions()) {
      const hold = (await this.deps.holds.listByAuction(auctionId)).find(
        (h) => h.authId === authId,
      );
      if (hold !== undefined) return hold;
    }
    return undefined;
  }
}
