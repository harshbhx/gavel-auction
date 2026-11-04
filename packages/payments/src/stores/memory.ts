import type { HoldStore, JournalStore, WebhookEventStore } from '../ports.js';
import { canonicalJson } from '../types.js';
import type { HoldRecord, Journal, StoredWebhook } from '../types.js';

/** Thrown by JournalStore.save when the stored version is not the expected one. */
export class VersionConflict extends Error {
  expectedVersion: number;
  actualVersion: number | null;
  constructor(auctionId: string, expectedVersion: number, actualVersion: number | null) {
    super(
      `journal ${auctionId} version conflict: expected ${expectedVersion}, found ${
        actualVersion === null ? 'none' : actualVersion
      }`,
    );
    this.name = 'VersionConflict';
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}

/** Thrown by JournalStore.create when a journal for the auction already exists. */
export class JournalExists extends Error {
  constructor(auctionId: string) {
    super(`journal ${auctionId} already exists`);
    this.name = 'JournalExists';
  }
}

export interface LeaseRecord {
  owner: string;
  expiresAtMs: number;
}

export interface JournalSnapshot {
  /** auctionId -> canonical JSON of the journal. */
  journals: Record<string, string>;
  leases: Record<string, LeaseRecord>;
}

export interface WebhookSnapshot {
  events: Record<string, StoredWebhook>;
}

export interface HoldSnapshot {
  holds: Record<string, HoldRecord>;
}

function clone<T>(v: T): T {
  return structuredClone(v);
}

/**
 * In-memory JournalStore. Journals are held as canonical JSON, so a caller never
 * shares object identity with the store and journals compare byte for byte.
 *
 * `onChange` is called synchronously after every mutation with a snapshot; the
 * file-backed store uses it to persist.
 */
export class MemoryJournalStore implements JournalStore {
  private journals = new Map<string, string>();
  private leases = new Map<string, LeaseRecord>();

  constructor(
    initial?: JournalSnapshot,
    private readonly onChange?: (s: JournalSnapshot) => void,
  ) {
    if (initial !== undefined) {
      for (const [k, v] of Object.entries(initial.journals)) this.journals.set(k, v);
      for (const [k, v] of Object.entries(initial.leases)) this.leases.set(k, { ...v });
    }
  }

  snapshot(): JournalSnapshot {
    return {
      journals: Object.fromEntries(this.journals),
      leases: Object.fromEntries([...this.leases].map(([k, v]) => [k, { ...v }])),
    };
  }

  private changed(): void {
    this.onChange?.(this.snapshot());
  }

  async load(auctionId: string): Promise<Journal | null> {
    const raw = this.journals.get(auctionId);
    return raw === undefined ? null : (JSON.parse(raw) as Journal);
  }

  async create(j: Journal): Promise<void> {
    if (this.journals.has(j.auctionId)) throw new JournalExists(j.auctionId);
    this.commit(j.auctionId, canonicalJson(j));
  }

  async save(j: Journal, expectedVersion: number): Promise<void> {
    const raw = this.journals.get(j.auctionId);
    const current = raw === undefined ? null : (JSON.parse(raw) as Journal).version;
    if (current === null || current !== expectedVersion) {
      throw new VersionConflict(j.auctionId, expectedVersion, current);
    }
    this.commit(j.auctionId, canonicalJson(j));
  }

  /**
   * Applies a journal change and persists it; when persisting throws, the map is
   * put back so memory never holds a change the disk does not (R-PAY-042).
   */
  private commit(auctionId: string, canonical: string): void {
    const before = this.journals.get(auctionId);
    this.journals.set(auctionId, canonical);
    try {
      this.changed();
    } catch (e) {
      if (before === undefined) this.journals.delete(auctionId);
      else this.journals.set(auctionId, before);
      throw e;
    }
  }

  async acquireLease(
    auctionId: string,
    owner: string,
    ttlMs: number,
    nowMs: number,
  ): Promise<boolean> {
    const cur = this.leases.get(auctionId);
    if (cur !== undefined && cur.owner !== owner && cur.expiresAtMs > nowMs) return false;
    this.leases.set(auctionId, { owner, expiresAtMs: nowMs + ttlMs });
    try {
      this.changed();
    } catch (e) {
      if (cur === undefined) this.leases.delete(auctionId);
      else this.leases.set(auctionId, cur);
      throw e;
    }
    return true;
  }

  async releaseLease(auctionId: string, owner: string): Promise<void> {
    const cur = this.leases.get(auctionId);
    if (cur === undefined || cur.owner !== owner) return;
    this.leases.delete(auctionId);
    try {
      this.changed();
    } catch (e) {
      this.leases.set(auctionId, cur);
      throw e;
    }
  }
}

/**
 * In-memory WebhookEventStore. An "orphan" is an event parked until a time and
 * not yet processed; listOrphans returns those still inside their window
 * (parkedUntilMs > nowMs) so the sweep can retry them.
 */
export class MemoryWebhookEventStore implements WebhookEventStore {
  private events = new Map<string, StoredWebhook>();

  constructor(
    initial?: WebhookSnapshot,
    private readonly onChange?: (s: WebhookSnapshot) => void,
  ) {
    if (initial !== undefined) {
      for (const [k, v] of Object.entries(initial.events)) this.events.set(k, clone(v));
    }
  }

  snapshot(): WebhookSnapshot {
    return { events: Object.fromEntries([...this.events].map(([k, v]) => [k, clone(v)])) };
  }

  private changed(): void {
    this.onChange?.(this.snapshot());
  }

  async insertIfAbsent(e: StoredWebhook): Promise<boolean> {
    if (this.events.has(e.id)) return false;
    this.events.set(e.id, clone(e));
    try {
      this.changed();
    } catch (err) {
      this.events.delete(e.id);
      throw err;
    }
    return true;
  }

  async markProcessed(id: string, result: string): Promise<void> {
    const cur = this.events.get(id);
    if (cur === undefined) throw new Error(`unknown webhook event ${id}`);
    const next: StoredWebhook = { ...cur, result };
    delete next.parkedUntilMs;
    this.replaceEvent(id, cur, next);
  }

  async parkOrphan(id: string, untilMs: number): Promise<void> {
    const cur = this.events.get(id);
    if (cur === undefined) throw new Error(`unknown webhook event ${id}`);
    this.replaceEvent(id, cur, { ...cur, parkedUntilMs: untilMs });
  }

  /** Swaps an event and persists; a failed write restores the previous event. */
  private replaceEvent(id: string, previous: StoredWebhook, next: StoredWebhook): void {
    this.events.set(id, next);
    try {
      this.changed();
    } catch (e) {
      this.events.set(id, previous);
      throw e;
    }
  }

  async listOrphans(nowMs: number): Promise<StoredWebhook[]> {
    return [...this.events.values()]
      .filter(
        (e) => e.result === undefined && e.parkedUntilMs !== undefined && e.parkedUntilMs > nowMs,
      )
      .sort((a, b) => a.receivedAtMs - b.receivedAtMs || (a.id < b.id ? -1 : 1))
      .map(clone);
  }

  async listUnprocessed(): Promise<StoredWebhook[]> {
    return [...this.events.values()]
      .filter((e) => e.result === undefined)
      .sort((a, b) => a.receivedAtMs - b.receivedAtMs || (a.id < b.id ? -1 : 1))
      .map(clone);
  }
}

/** In-memory HoldStore. */
export class MemoryHoldStore implements HoldStore {
  private holds = new Map<string, HoldRecord>();

  constructor(
    initial?: HoldSnapshot,
    private readonly onChange?: (s: HoldSnapshot) => void,
  ) {
    if (initial !== undefined) {
      for (const [k, v] of Object.entries(initial.holds)) this.holds.set(k, clone(v));
    }
  }

  snapshot(): HoldSnapshot {
    return { holds: Object.fromEntries([...this.holds].map(([k, v]) => [k, clone(v)])) };
  }

  async get(holdId: string): Promise<HoldRecord | null> {
    const h = this.holds.get(holdId);
    return h === undefined ? null : clone(h);
  }

  /** Newest hold (by createdAtMs) of the bidder in the auction, or null. */
  async byBidder(auctionId: string, bidderId: string): Promise<HoldRecord | null> {
    let best: HoldRecord | null = null;
    for (const h of this.holds.values()) {
      if (h.auctionId !== auctionId || h.bidderId !== bidderId) continue;
      if (best === null || h.createdAtMs > best.createdAtMs) best = h;
    }
    return best === null ? null : clone(best);
  }

  async put(h: HoldRecord): Promise<void> {
    const before = this.holds.get(h.holdId);
    this.holds.set(h.holdId, clone(h));
    try {
      this.onChange?.(this.snapshot());
    } catch (e) {
      if (before === undefined) this.holds.delete(h.holdId);
      else this.holds.set(h.holdId, before);
      throw e;
    }
  }

  /** Ordered by createdAtMs, then holdId. */
  async listByAuction(auctionId: string): Promise<HoldRecord[]> {
    return [...this.holds.values()]
      .filter((h) => h.auctionId === auctionId)
      .sort((a, b) => a.createdAtMs - b.createdAtMs || (a.holdId < b.holdId ? -1 : 1))
      .map(clone);
  }
}
