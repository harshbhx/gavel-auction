import { GavelError, type AuctionId, type CancelTimer, type Clock } from '@gavel/shared';
import type { Room } from './room';

/** R-RT-062: a finished room with no connections is evicted after this much idle time. */
export const ROOM_IDLE_MS = 15 * 60_000;
export const SWEEP_INTERVAL_MS = 60_000;

export interface RoomRegistryOptions {
  clock: Clock;
  /** Loads a room from its log (the auction service's `room`). */
  load: (auctionId: AuctionId) => Promise<Room>;
  /** True once the room has reached its terminal state. */
  isDone: (room: Room) => boolean;
  /** Instance room cap. */
  maxRooms: number;
  idleMs?: number;
  sweepMs?: number;
}

interface Entry {
  room: Promise<Room>;
  lastActive: number;
}

/** Loads rooms lazily, enforces the room cap and evicts idle finished rooms (R-RT-062). */
export class RoomRegistry {
  private readonly rooms = new Map<AuctionId, Entry>();
  private cancelSweep: CancelTimer | undefined;
  private stopped = false;
  private readonly idleMs: number;
  private readonly sweepMs: number;

  constructor(private readonly opts: RoomRegistryOptions) {
    this.idleMs = opts.idleMs ?? ROOM_IDLE_MS;
    this.sweepMs = opts.sweepMs ?? SWEEP_INTERVAL_MS;
  }

  get size(): number {
    return this.rooms.size;
  }

  /** The room, loaded on first use. Throws `room_cap` when a new room would exceed the cap. */
  get(auctionId: AuctionId): Promise<Room> {
    const now = this.opts.clock.now();
    const existing = this.rooms.get(auctionId);
    if (existing !== undefined) {
      existing.lastActive = now;
      return existing.room;
    }
    if (this.rooms.size >= this.opts.maxRooms) {
      return Promise.reject(new GavelError('room_cap', 'room cap reached'));
    }
    const entry: Entry = { room: this.opts.load(auctionId), lastActive: now };
    this.rooms.set(auctionId, entry);
    entry.room.catch(() => {
      if (this.rooms.get(auctionId) === entry) this.rooms.delete(auctionId);
    });
    return entry.room;
  }

  /** Record activity so a busy room is not treated as idle. */
  touch(auctionId: AuctionId): void {
    const entry = this.rooms.get(auctionId);
    if (entry !== undefined) entry.lastActive = this.opts.clock.now();
  }

  /** Evict every finished, unconnected room idle for the full period. Returns the evicted ids. */
  async sweep(): Promise<AuctionId[]> {
    const now = this.opts.clock.now();
    const evicted: AuctionId[] = [];
    for (const [id, entry] of [...this.rooms]) {
      if (now - entry.lastActive < this.idleMs) continue;
      let room: Room;
      try {
        room = await entry.room;
      } catch {
        continue;
      }
      if (this.rooms.get(id) !== entry) continue;
      if (room.connectionCount > 0 || !this.opts.isDone(room)) continue;
      this.rooms.delete(id);
      await room.close();
      evicted.push(id);
    }
    return evicted;
  }

  /** Run `sweep` on the clock until `stop`. */
  start(): void {
    this.stopped = false;
    this.arm();
  }

  stop(): void {
    this.stopped = true;
    this.cancelSweep?.();
    this.cancelSweep = undefined;
  }

  private arm(): void {
    this.cancelSweep = this.opts.clock.setTimer(this.opts.clock.now() + this.sweepMs, () => {
      void this.sweep()
        .catch(() => undefined)
        .finally(() => {
          if (!this.stopped) this.arm();
        });
    });
  }
}
