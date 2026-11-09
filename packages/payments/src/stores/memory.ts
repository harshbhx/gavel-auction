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
  /** Ids of processed events dropped by prune(), oldest first, kept so a replay is still a duplicate. */
  pruned?: string[];
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

/** How many pruned event ids are remembered for dedupe. */
export const MAX_PRUNED_WEBHOOK_IDS = 20_000;

/**
 * In-memory WebhookEventStore. An "orphan" is an event parked until a time and
 * not yet processed; listOrphans returns those still inside their window
 * (parkedUntilMs > nowMs) so the sweep can retry them.
 *
 * Unprocessed events are also tracked in a set, so the sweep reads only those and
 * not the whole history. prune() drops processed events past a retention window
 * and remembers their ids (bounded) so a late redelivery is still a duplicate.
 */
export class MemoryWebhookEventStore implements WebhookEventStore {
  private events = new Map<string, StoredWebhook>();
  private unprocessed = new Set<string>();
  /** Insertion ordered, so the oldest tombstone is the first key. */
  private pruned = new Set<string>();

  constructor(
    initial?: WebhookSnapshot,
    private readonly onChange?: (s: WebhookSnapshot) => void,
  ) {
    if (initial !== undefined) {
      for (const [k, v] of Object.entries(initial.events)) {
        this.events.set(k, clone(v));
        if (v.result === undefined) this.unprocessed.add(k);
      }
      for (const id of initial.pruned ?? []) this.pruned.add(id);
    }
  }

  snapshot(): WebhookSnapshot {
    const snap: WebhookSnapshot = {
      events: Object.fromEntries([...this.events].map(([k, v]) => [k, clone(v)])),
    };
    // Omitted while empty so files written before pruning existed keep their shape.
    if (this.pruned.size > 0) snap.pruned = [...this.pruned];
    return snap;
  }

  private changed(): void {
    this.onChange?.(this.snapshot());
  }

  async insertIfAbsent(e: StoredWebhook): Promise<boolean> {
    if (this.events.has(e.id) || this.pruned.has(e.id)) return false;
    this.events.set(e.id, clone(e));
    if (e.result === undefined) this.unprocessed.add(e.id);
    try {
      this.changed();
    } catch (err) {
      this.events.delete(e.id);
      this.unprocessed.delete(e.id);
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
    if (next.result === undefined) this.unprocessed.add(id);
    else this.unprocessed.delete(id);
    try {
      this.changed();
    } catch (e) {
      this.events.set(id, previous);
      if (previous.result === undefined) this.unprocessed.add(id);
      else this.unprocessed.delete(id);
      throw e;
    }
  }

  private unprocessedEvents(): StoredWebhook[] {
    const out: StoredWebhook[] = [];
    for (const id of this.unprocessed) {
      const e = this.events.get(id);
      if (e !== undefined) out.push(e);
    }
    return out;
  }

  async listOrphans(nowMs: number): Promise<StoredWebhook[]> {
    return this.unprocessedEvents()
      .filter((e) => e.parkedUntilMs !== undefined && e.parkedUntilMs > nowMs)
      .sort((a, b) => a.receivedAtMs - b.receivedAtMs || (a.id < b.id ? -1 : 1))
      .map(clone);
  }

  async listUnprocessed(): Promise<StoredWebhook[]> {
    return this.unprocessedEvents()
      .sort((a, b) => a.receivedAtMs - b.receivedAtMs || (a.id < b.id ? -1 : 1))
      .map(clone);
  }

  /**
   * Drops processed events received before `beforeMs` and remembers their ids (at most
   * MAX_PRUNED_WEBHOOK_IDS, oldest forgotten first) so a redelivery is still refused as a
   * duplicate. An event without a result is never dropped. Returns how many were dropped;
   * a failed write puts everything back.
   */
  async prune(beforeMs: number): Promise<number> {
    const drop: StoredWebhook[] = [];
    for (const e of this.events.values()) {
      if (e.result !== undefined && e.receivedAtMs < beforeMs) drop.push(e);
    }
    if (drop.length === 0) return 0;
    const prevPruned = new Set(this.pruned);
    for (const e of drop) {
      this.events.delete(e.id);
      this.pruned.add(e.id);
    }
    while (this.pruned.size > MAX_PRUNED_WEBHOOK_IDS) {
      const oldest = this.pruned.values().next().value as string;
      this.pruned.delete(oldest);
    }
    try {
      this.changed();
    } catch (err) {
      for (const e of drop) this.events.set(e.id, e);
      this.pruned = prevPruned;
      throw err;
    }
    return drop.length;
  }
}

/** In-memory HoldStore, with indexes by authorization id and by auction. */
export class MemoryHoldStore implements HoldStore {
  private holds = new Map<string, HoldRecord>();
  private byAuth = new Map<string, Set<string>>();
  private byAuctionIdx = new Map<string, Set<string>>();

  constructor(
    initial?: HoldSnapshot,
    private readonly onChange?: (s: HoldSnapshot) => void,
  ) {
    if (initial !== undefined) {
      for (const [k, v] of Object.entries(initial.holds)) this.setHold(k, clone(v));
    }
  }

  snapshot(): HoldSnapshot {
    return { holds: Object.fromEntries([...this.holds].map(([k, v]) => [k, clone(v)])) };
  }

  /** Stores a record and keeps both indexes in step, including when its keys changed. */
  private setHold(holdId: string, h: HoldRecord): void {
    this.removeHold(holdId);
    this.holds.set(holdId, h);
    addTo(this.byAuctionIdx, h.auctionId, holdId);
    if (h.authId !== undefined) addTo(this.byAuth, h.authId, holdId);
  }

  private removeHold(holdId: string): void {
    const cur = this.holds.get(holdId);
    if (cur === undefined) return;
    this.holds.delete(holdId);
    removeFrom(this.byAuctionIdx, cur.auctionId, holdId);
    if (cur.authId !== undefined) removeFrom(this.byAuth, cur.authId, holdId);
  }

  async get(holdId: string): Promise<HoldRecord | null> {
    const h = this.holds.get(holdId);
    return h === undefined ? null : clone(h);
  }

  private auctionHolds(auctionId: string): HoldRecord[] {
    const out: HoldRecord[] = [];
    for (const id of this.byAuctionIdx.get(auctionId) ?? []) {
      const h = this.holds.get(id);
      if (h !== undefined) out.push(h);
    }
    return out;
  }

  /** Newest hold (by createdAtMs) of the bidder in the auction, or null. */
  async byBidder(auctionId: string, bidderId: string): Promise<HoldRecord | null> {
    let best: HoldRecord | null = null;
    for (const h of this.auctionHolds(auctionId)) {
      if (h.bidderId !== bidderId) continue;
      if (best === null || h.createdAtMs > best.createdAtMs) best = h;
    }
    return best === null ? null : clone(best);
  }

  /** The hold whose current `authId` is the given one (the oldest when several share it), or null. */
  async byAuthId(authId: string): Promise<HoldRecord | null> {
    let best: HoldRecord | null = null;
    for (const id of this.byAuth.get(authId) ?? []) {
      const h = this.holds.get(id);
      if (h === undefined) continue;
      if (
        best === null ||
        h.createdAtMs < best.createdAtMs ||
        (h.createdAtMs === best.createdAtMs && h.holdId < best.holdId)
      ) {
        best = h;
      }
    }
    return best === null ? null : clone(best);
  }

  async put(h: HoldRecord): Promise<void> {
    const before = this.holds.get(h.holdId);
    this.setHold(h.holdId, clone(h));
    try {
      this.onChange?.(this.snapshot());
    } catch (e) {
      if (before === undefined) this.removeHold(h.holdId);
      else this.setHold(h.holdId, before);
      throw e;
    }
  }

  /** Ordered by createdAtMs, then holdId. */
  async listByAuction(auctionId: string): Promise<HoldRecord[]> {
    return this.auctionHolds(auctionId)
      .sort((a, b) => a.createdAtMs - b.createdAtMs || (a.holdId < b.holdId ? -1 : 1))
      .map(clone);
  }
}

function addTo(m: Map<string, Set<string>>, key: string, id: string): void {
  let set = m.get(key);
  if (set === undefined) m.set(key, (set = new Set()));
  set.add(id);
}

function removeFrom(m: Map<string, Set<string>>, key: string, id: string): void {
  const set = m.get(key);
  if (set === undefined) return;
  set.delete(id);
  if (set.size === 0) m.delete(key);
}
