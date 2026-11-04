import type { SettlementState } from './enums';
import type { AuctionId, BidderId, Jti } from './ids';
import type { Cents } from './money';
import type { EpochMs } from './time';

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

export interface RoomStore {
  appendEvents(auctionId: AuctionId, expectedSeq: number, events: unknown[]): Promise<void>;
  readEvents(auctionId: AuctionId, fromSeq: number, limit: number): Promise<unknown[]>;
  lastSeq(auctionId: AuctionId): Promise<number>;
  saveSnapshot(auctionId: AuctionId, seq: number, state: unknown): Promise<void>;
  loadSnapshot(auctionId: AuctionId): Promise<{ seq: number; state: unknown } | null>;
  consumeJti(jti: Jti, ttlMs: number): Promise<boolean>;
  denyJti(jti: Jti, untilMs: EpochMs): Promise<void>;
  isDenied(jti: Jti): Promise<boolean>;
  getJournal(key: string): Promise<{ version: number; value: unknown } | null>;
  putJournal(key: string, expectedVersion: number, value: unknown): Promise<void>;
  listAuctions(): Promise<AuctionId[]>;
  ping(): Promise<void>;
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

export interface EnginePort {
  register(bidder: string, ceiling: number): void;
  placeBid(
    bidder: string,
    amount: number,
    ts: number,
  ): { price: number | null; leader: string | null; endTs: number };
  tick(now: number): 'OPEN' | 'CLOSING' | 'SETTLING' | 'DONE';
  hammer(now: number): HammerOutcome;
  extendTo(endTs: number): void;
  complete(): void;
  view(): {
    state: string;
    price: number | null;
    leader: string | null;
    endTs: number;
    extensions: number;
    minNext: number;
    ranking: Array<[string, number]>;
  };
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
