import { GavelError } from '@gavel/shared';
import type { AuctionId, EpochMs, Jti, RoomEvent, RoomStore } from '@gavel/shared';

interface Journal {
  version: number;
  value: unknown;
}

/** Full RoomStore contract in process memory: the default for tests and the demo. */
export class MemoryStore implements RoomStore {
  private readonly logs = new Map<AuctionId, RoomEvent[]>();
  private readonly snapshots = new Map<AuctionId, { seq: number; state: unknown }>();
  private readonly used = new Map<string, number>();
  private readonly denied = new Map<string, number>();
  private readonly journals = new Map<string, Journal>();

  constructor(private readonly now: () => number = () => 0) {}

  async appendEvents(
    auctionId: AuctionId,
    expectedSeq: number,
    events: RoomEvent[],
  ): Promise<void> {
    const log = this.logs.get(auctionId) ?? [];
    if (log.length !== expectedSeq) {
      throw new GavelError('conflict', `expected seq ${expectedSeq}, store is at ${log.length}`);
    }
    // Validate the whole batch first so a bad batch appends nothing.
    events.forEach((e, i) => {
      if (e.seq !== expectedSeq + 1 + i || e.auctionId !== auctionId) {
        throw new GavelError('conflict', 'events must be gapless and belong to the auction');
      }
    });
    this.logs.set(auctionId, [...log, ...events]);
  }

  async readEvents(auctionId: AuctionId, fromSeq: number, limit: number): Promise<RoomEvent[]> {
    const log = this.logs.get(auctionId) ?? [];
    return log.filter((e) => e.seq >= fromSeq).slice(0, Math.max(0, limit));
  }

  async lastSeq(auctionId: AuctionId): Promise<number> {
    return this.logs.get(auctionId)?.length ?? 0;
  }

  async saveSnapshot(auctionId: AuctionId, seq: number, state: unknown): Promise<void> {
    this.snapshots.set(auctionId, { seq, state });
  }

  async loadSnapshot(auctionId: AuctionId): Promise<{ seq: number; state: unknown } | null> {
    return this.snapshots.get(auctionId) ?? null;
  }

  async consumeJti(jti: Jti, ttlMs: number): Promise<boolean> {
    const until = this.used.get(jti);
    if (until !== undefined && until > this.now()) return false;
    this.used.set(jti, this.now() + ttlMs);
    return true;
  }

  async denyJti(jti: Jti, untilMs: EpochMs): Promise<void> {
    this.denied.set(jti, untilMs);
  }

  async isDenied(jti: Jti): Promise<boolean> {
    const until = this.denied.get(jti);
    return until !== undefined && until > this.now();
  }

  async getJournal(key: string): Promise<{ version: number; value: unknown } | null> {
    return this.journals.get(key) ?? null;
  }

  async putJournal(key: string, expectedVersion: number, value: unknown): Promise<void> {
    const current = this.journals.get(key)?.version ?? 0;
    if (current !== expectedVersion) throw new GavelError('conflict', 'journal version mismatch');
    this.journals.set(key, { version: current + 1, value });
  }

  async listAuctions(): Promise<AuctionId[]> {
    return [...this.logs.keys()];
  }

  async ping(): Promise<void> {
    return;
  }
}
