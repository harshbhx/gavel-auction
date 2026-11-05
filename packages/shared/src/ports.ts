import type { SettlementState } from './enums';
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

export interface HammerOutcome {
  readonly winner: BidderId | null;
  readonly price: Cents;
  readonly ranking: ReadonlyArray<{ readonly bidderId: BidderId; readonly amount: Cents }>;
}

export type TokenKind = 'session' | 'auctioneer' | 'admin';

export interface TokenClaims {
  readonly sub: string;
  readonly kind: TokenKind;
  readonly aud: AuctionId;
  readonly iat: number;
  readonly exp: number;
  readonly jti: Jti;
}

export interface PaymentsPort {
  settle(req: {
    auctionId: AuctionId;
    outcome: HammerOutcome;
    holds: Record<string, string>;
  }): Promise<void>;
  handleWebhook(req: {
    rawBody: Uint8Array;
    headers: Record<string, string>;
    /** The sender's address as the route knows it; feeds the per-source call limit (R9-M02). */
    source?: string | undefined;
  }): Promise<
    | { kind: 'ok'; auctionId?: AuctionId }
    | { kind: 'duplicate' }
    | { kind: 'invalid_signature' }
    | { kind: 'retry'; reason: string }
  >;
  onSettlementUpdate(
    cb: (u: {
      auctionId: AuctionId;
      rev: number;
      auctionState: SettlementState;
      perBidder: Record<string, SettlementState>;
      amountCaptured?: Cents;
      note?: string;
    }) => void,
  ): () => void;
  onHoldReported(
    cb: (h: {
      auctionId: AuctionId;
      bidderId: BidderId;
      name: string;
      ceiling: Cents;
      holdRef: string;
    }) => void,
  ): () => void;
}

export interface Logger {
  debug(m: string, c?: object): void;
  info(m: string, c?: object): void;
  warn(m: string, c?: object): void;
  error(m: string, c?: object): void;
  child(c: object): Logger;
}

export interface TokenSigner {
  sign(claims: TokenClaims): Promise<string>;
  verify(token: string, expectKind?: TokenKind[]): Promise<TokenClaims>;
}
