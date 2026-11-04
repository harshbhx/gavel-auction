import { GavelError } from '@gavel/shared';
import type { RoomStore } from '@gavel/shared';
import { JournalExists, VersionConflict } from '@gavel/payments';
import type { Journal, JournalStore } from '@gavel/payments';

/**
 * A payments JournalStore on top of a RoomStore (R-PAY-041, R-PAY-043, R-RT-022).
 *
 * Version rule, stated once: payments creates a journal at version 0 and every
 * save stores version + 1, while a RoomStore slot is absent at 0 and goes to
 * current + 1 on every put. So the slot version is always the journal version
 * plus one: `create` puts with expected slot version 0, and `save(j, v)` puts
 * with expected slot version v + 1. The journal's own `version` stays the
 * source for the payments side; the slot version only guards the write.
 *
 * Errors: a RoomStore `conflict` becomes JournalExists on create and
 * VersionConflict on save, the types the saga catches.
 *
 * Lease: a second slot per auction holds `{ owner, expiresAtMs }` and is taken
 * with the same compare-and-set, so two hosts cannot both hold it. A host that
 * loses the race gets `false`, never an exception.
 */

interface LeaseValue {
  owner: string;
  expiresAtMs: number;
}

const journalKey = (auctionId: string): string => `journal:${auctionId}`;
const leaseKey = (auctionId: string): string => `lease:${auctionId}`;

function isConflict(e: unknown): boolean {
  return e instanceof GavelError && e.code === 'conflict';
}

export class RoomJournalStore implements JournalStore {
  constructor(private readonly store: RoomStore) {}

  async load(auctionId: string): Promise<Journal | null> {
    const slot = await this.store.getJournal(journalKey(auctionId));
    return slot === null ? null : structuredClone(slot.value as Journal);
  }

  async create(j: Journal): Promise<void> {
    try {
      await this.store.putJournal(journalKey(j.auctionId), 0, structuredClone(j));
    } catch (e) {
      if (isConflict(e)) throw new JournalExists(j.auctionId);
      throw e;
    }
  }

  async save(j: Journal, expectedVersion: number): Promise<void> {
    const key = journalKey(j.auctionId);
    const slot = await this.store.getJournal(key);
    const actual = slot === null ? null : (slot.value as Journal).version;
    if (slot === null || actual !== expectedVersion) {
      throw new VersionConflict(j.auctionId, expectedVersion, actual);
    }
    try {
      await this.store.putJournal(key, slot.version, structuredClone(j));
    } catch (e) {
      if (!isConflict(e)) throw e;
      const now = await this.store.getJournal(key);
      throw new VersionConflict(
        j.auctionId,
        expectedVersion,
        now === null ? null : (now.value as Journal).version,
      );
    }
  }

  async acquireLease(
    auctionId: string,
    owner: string,
    ttlMs: number,
    nowMs: number,
  ): Promise<boolean> {
    const key = leaseKey(auctionId);
    const slot = await this.store.getJournal(key);
    const cur = slot === null ? null : (slot.value as LeaseValue);
    if (cur !== null && cur.owner !== owner && cur.expiresAtMs > nowMs) return false;
    const next: LeaseValue = { owner, expiresAtMs: nowMs + ttlMs };
    try {
      await this.store.putJournal(key, slot?.version ?? 0, next);
      return true;
    } catch (e) {
      if (isConflict(e)) return false;
      throw e;
    }
  }

  async releaseLease(auctionId: string, owner: string): Promise<void> {
    const key = leaseKey(auctionId);
    const slot = await this.store.getJournal(key);
    if (slot === null) return;
    const cur = slot.value as LeaseValue;
    if (cur.owner !== owner) return;
    try {
      // An expired record no owner can match: the lease is free.
      await this.store.putJournal(key, slot.version, { owner: '', expiresAtMs: 0 });
    } catch (e) {
      if (!isConflict(e)) throw e;
    }
  }
}
