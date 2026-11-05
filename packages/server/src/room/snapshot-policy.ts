import type { AuctionId, RoomStore } from '@gavel/shared';

/** A snapshot is saved at least every this many events (R-RT-095). */
export const SNAPSHOT_EVERY_EVENTS = 100;

export interface SnapshotInput {
  /** Seq of the last event just committed. */
  seq: number;
  /** Seq of the last saved snapshot, 0 when none. */
  lastSavedSeq: number;
  /** True when the committed events changed the auction state. */
  stateChanged: boolean;
}

/** True when a snapshot is due: on a state change, or once 100 events passed since the last one. */
export function snapshotDue(input: SnapshotInput): boolean {
  if (input.seq <= input.lastSavedSeq) return false;
  return input.stateChanged || input.seq - input.lastSavedSeq >= SNAPSHOT_EVERY_EVENTS;
}

/**
 * Applies the snapshot policy for one auction. Saving is best effort: a failed save is
 * reported through `onError` and never fails the command, because recovery replays the
 * log and works with no snapshot at all (R-RT-095).
 */
export class SnapshotPolicy {
  private lastSavedSeq: number;

  constructor(
    private readonly store: RoomStore,
    private readonly auctionId: AuctionId,
    startSeq = 0,
    private readonly onError: (err: unknown) => void = () => undefined,
  ) {
    this.lastSavedSeq = startSeq;
  }

  /** Call after events up to `seq` are durable. Returns true when a snapshot was saved. */
  async afterCommit(seq: number, stateChanged: boolean, state: () => unknown): Promise<boolean> {
    if (!snapshotDue({ seq, lastSavedSeq: this.lastSavedSeq, stateChanged })) return false;
    try {
      await this.store.saveSnapshot(this.auctionId, seq, state());
    } catch (err) {
      this.onError(err);
      return false;
    }
    this.lastSavedSeq = seq;
    return true;
  }
}
