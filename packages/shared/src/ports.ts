import type { ErrorCode } from './errors';
import type { RoomEvent } from './events';
import type { AuctionId, BidderId, Jti } from './ids';
import type { Cents } from './money';
import type { EpochMs } from './time';

/** Port declarations only (R-RT-022): no implementation code lives in this file. */

/** Durable, append-only event log plus the small keyed state the room needs. */
export interface RoomStore {
  /**
   * Append events whose seq runs from `expectedSeq + 1` without a gap.
   * Throws `conflict` when the stored last seq differs from `expectedSeq`.
   */
  appendEvents(auctionId: AuctionId, expectedSeq: number, events: RoomEvent[]): Promise<void>;
  readEvents(auctionId: AuctionId, fromSeq: number, limit: number): Promise<RoomEvent[]>;
  lastSeq(auctionId: AuctionId): Promise<number>;
  saveSnapshot(auctionId: AuctionId, seq: number, state: unknown): Promise<void>;
  loadSnapshot(auctionId: AuctionId): Promise<{ seq: number; state: unknown } | null>;
  /** True when this is the first use of the jti. */
  consumeJti(jti: Jti, ttlMs: number): Promise<boolean>;
  denyJti(jti: Jti, untilMs: EpochMs): Promise<void>;
  isDenied(jti: Jti): Promise<boolean>;
  getJournal(key: string): Promise<{ version: number; value: unknown } | null>;
  /** Throws `conflict` when `expectedVersion` is not the stored version (0 when absent). */
  putJournal(key: string, expectedVersion: number, value: unknown): Promise<void>;
  listAuctions(): Promise<AuctionId[]>;
  ping(): Promise<void>;
}

export type EngineState = 'OPEN' | 'CLOSING' | 'SETTLING' | 'DONE';

export type EngineBidResult =
  | { ok: true }
  | {
      /** Maps one-to-one to `bid_rejected.reason` (R-RT-035). */
      ok: false;
      code: ErrorCode;
    };

export interface EngineView {
  state: EngineState;
  price: Cents | null;
  leader: BidderId | null;
  endTs: EpochMs;
  extensions: number;
  minNext: Cents;
}

/** What the room needs from the auction engine. */
export interface EnginePort {
  register(bidder: BidderId, ceiling: Cents): void;
  placeBid(bidder: BidderId, amount: Cents, ts: EpochMs): EngineBidResult;
  tick(now: EpochMs): EngineState;
  view(): EngineView;
}

/** The room's only way to reach one connection (R-RT-070). */
export interface Transport {
  /** Queue one encoded frame. */
  send(text: string): void;
  /** Close with a WebSocket close code. */
  close(code: number, reason: string): void;
}
