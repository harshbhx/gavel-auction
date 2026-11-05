import { GavelError } from '@gavel/shared';
import type { AuctionId, EpochMs, Jti, RoomEvent, RoomStore } from '@gavel/shared';

export type AppendFault = 'fail' | 'conflict';

/**
 * Wraps a RoomStore and misbehaves on demand: fail or conflict on the Nth append,
 * or delay every append. Everything else delegates untouched.
 */
export class FlakyStore implements RoomStore {
  private appends = 0;
  private readonly faults = new Map<number, AppendFault>();
  private delay: Promise<void> | undefined;

  constructor(private readonly inner: RoomStore) {}

  /** Make the Nth append from now (1 is the next one) throw. */
  failAppend(nth: number, kind: AppendFault = 'fail'): void {
    this.faults.set(this.appends + nth, kind);
  }

  /** Hold every append until the returned function is called. */
  delayAppends(): () => void {
    let release: () => void = () => undefined;
    this.delay = new Promise<void>((resolve) => {
      release = resolve;
    });
    return () => {
      release();
      this.delay = undefined;
    };
  }

  async appendEvents(
    auctionId: AuctionId,
    expectedSeq: number,
    events: RoomEvent[],
  ): Promise<void> {
    if (this.delay) await this.delay;
    this.appends += 1;
    const fault = this.faults.get(this.appends);
    if (fault === 'fail') throw new Error('flaky store: append failed');
    if (fault === 'conflict') throw new GavelError('conflict', 'flaky store: forced conflict');
    return this.inner.appendEvents(auctionId, expectedSeq, events);
  }

  readEvents(auctionId: AuctionId, fromSeq: number, limit: number): Promise<RoomEvent[]> {
    return this.inner.readEvents(auctionId, fromSeq, limit);
  }
  lastSeq(auctionId: AuctionId): Promise<number> {
    return this.inner.lastSeq(auctionId);
  }
  saveSnapshot(auctionId: AuctionId, seq: number, state: unknown): Promise<void> {
    return this.inner.saveSnapshot(auctionId, seq, state);
  }
  loadSnapshot(auctionId: AuctionId): Promise<{ seq: number; state: unknown } | null> {
    return this.inner.loadSnapshot(auctionId);
  }
  consumeJti(jti: Jti, ttlMs: number): Promise<boolean> {
    return this.inner.consumeJti(jti, ttlMs);
  }
  denyJti(jti: Jti, untilMs: EpochMs): Promise<void> {
    return this.inner.denyJti(jti, untilMs);
  }
  isDenied(jti: Jti): Promise<boolean> {
    return this.inner.isDenied(jti);
  }
  getJournal(key: string): Promise<{ version: number; value: unknown } | null> {
    return this.inner.getJournal(key);
  }
  putJournal(key: string, expectedVersion: number, value: unknown): Promise<void> {
    return this.inner.putJournal(key, expectedVersion, value);
  }
  listAuctions(): Promise<AuctionId[]> {
    return this.inner.listAuctions();
  }
  ping(): Promise<void> {
    return this.inner.ping();
  }
}
