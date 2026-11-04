import {
  GavelError,
  type AuctionId,
  type EpochMs,
  type Jti,
  type RoomEvent,
  type RoomStore,
} from '@gavel/shared';

export interface FenceOptions {
  /** Called once per room when this host loses it; the host stops serving that room. */
  onFenced: (auctionId: AuctionId) => void;
}

/**
 * Wraps a RoomStore so a stale `expectedSeq` fences this host (R-RT-061): the
 * conflicting append fails with `conflict`, the room is marked fenced, and every
 * later append for it fails with `host_fenced` without touching the store.
 */
export class FencedStore implements RoomStore {
  private readonly fenced = new Set<AuctionId>();

  constructor(
    private readonly inner: RoomStore,
    private readonly opts: FenceOptions,
  ) {}

  isFenced(auctionId: AuctionId): boolean {
    return this.fenced.has(auctionId);
  }

  async appendEvents(
    auctionId: AuctionId,
    expectedSeq: number,
    events: RoomEvent[],
  ): Promise<void> {
    if (this.fenced.has(auctionId)) {
      throw new GavelError('host_fenced', 'this host no longer owns the room');
    }
    try {
      await this.inner.appendEvents(auctionId, expectedSeq, events);
    } catch (err) {
      if (err instanceof GavelError && err.code === 'conflict') {
        this.fenced.add(auctionId);
        this.opts.onFenced(auctionId);
      }
      throw err;
    }
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
