/**
 * Shared engine domain types. Money is integer cents, times are integer
 * epoch milliseconds supplied by the caller. No clock or random access here.
 */
export type Cents = number & { readonly __b: 'cents' };
export type EpochMs = number & { readonly __b: 'epochms' };
export type Ulid = string & { readonly __b: 'ulid' };
export type BidderId = string & { readonly __b: 'bidder' };
export type LotId = Ulid & { readonly __lot: true };
export type AuctionId = Ulid & { readonly __auction: true };
export type CommandId = Ulid & { readonly __command: true };

export type Mode = 'english' | 'proxy' | 'second_price';
export type LotStatus = 'PENDING' | 'OPEN' | 'CLOSING' | 'SETTLING' | 'DONE';
export type BidSource = 'voice' | 'manual' | 'qr';

export type IncrementRule =
  | { flatCents: number }
  | { ladder: Array<{ fromCents: number; incrementCents: number }> };

export interface SoftClose {
  windowMs: number;
  extensionMs: number;
  maxExtensions: number;
  hardCloseMs?: number;
}

export interface AuctionConfig {
  currency: 'USD';
  holdScope: 'event' | 'lot';
  maxCeilingCents: number;
  confirmBelowBps: number;
  fallbackPolicy: 'runner_up' | 'unsold';
  maxFallbackDepth: number;
}

export interface LotConfig {
  lotId: Ulid;
  title: string;
  mode: Mode;
  reserveCents: number;
  increment: IncrementRule;
  durationMs: number;
  softClose: SoftClose;
  hammer: 'auto' | 'manual';
}

export const LIMITS = {
  transcript: 2000,
  title: 120,
  lots: 200,
  bidders: 1000,
  bidsPerLot: 20000,
  holdRef: 128,
} as const;
