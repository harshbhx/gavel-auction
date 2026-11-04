import type { BidderId, Cents, EpochMs, ErrorCode } from '@gavel/shared';

export type Mode = 'inproc' | 'stack';

export type Checkpoint =
  | 'after_winner_selected'
  | 'before_capture_request'
  | 'after_capture_request_before_response'
  | 'after_capture_recorded'
  | `during_void_loop:${number}`
  | 'before_final_ledger';

export type Fault =
  | { at: 'paypal.capture'; kind: 'http'; status: 500 | 502 | 503 | 429; times: number }
  | { at: 'paypal.capture'; kind: 'timeout_after_commit' }
  | { at: 'paypal.void'; kind: 'http'; status: 500; times: number; bidder?: string }
  | { at: 'paypal.authorization'; kind: 'expire' | 'void_external' | 'decline'; bidder: string }
  | {
      at: 'webhook';
      kind: 'duplicate' | 'delay' | 'reorder';
      event: string;
      times?: number;
      ms?: number;
    }
  | { at: 'server'; kind: 'kill'; checkpoint: Checkpoint }
  | { at: 'stt'; kind: 'timeout' | 'garbage' | 'low_confidence'; times?: number }
  | { at: 'ws'; kind: 'drop'; client: string; forMs: number };

export type Step =
  | { t: number; actor: string; do: 'register'; ceiling: Cents; funding?: 'wallet' | 'card' }
  | { t: number; actor: string; do: 'bid'; amount: Cents; via?: 'qr' | 'voice' | 'manual' }
  | { t: number; actor: string; do: 'say'; audio: string }
  | { t: number; actor: string; do: 'confirm'; accept: boolean }
  | { t: number; actor: 'auctioneer'; do: 'open' | 'pause' | 'resume' | 'extend' | 'hammer' }
  | { t: number; actor: string; do: 'disconnect' | 'reconnect' }
  | { t: number; actor: string; do: 'send_raw'; frame: string }
  | { t: number; do: 'advance_clock'; ms: number }
  | { t: number; do: 'fault'; fault: Fault };

export type SettlementState =
  | 'HELD'
  | 'BIDDING'
  | 'WINNER_SELECTED'
  | 'CAPTURING'
  | 'CAPTURED'
  | 'VOIDING'
  | 'SETTLED'
  | 'FALLBACK_RUNNER_UP'
  | 'FAILED_NEEDS_REVIEW';

export type Invariant = 'I1' | 'I2' | 'I3' | 'I4' | 'I5';

export type Expect =
  | { ledger: { winner: string | null; captured: Cents; released: Cents; voided: string[] } }
  | { settlement: Record<string, SettlementState> }
  | { invariants: Invariant[] }
  | { rejected: Array<{ actor: string; code: ErrorCode }> }
  | { paypalCalls: { capture: number; void: number; reauthorize?: number } }
  | { ui?: { view: 'bidder' | 'auctioneer' | 'public' | 'audit'; text?: string; a11y?: true } };

export interface Scenario {
  id: string;
  title: string;
  modes: Mode[];
  seed: number;
  clock: { startMs: EpochMs };
  auction: {
    itemId: string;
    reserve: Cents;
    minIncrement: Cents;
    softCloseMs: number;
    mode: 'english';
  };
  actors: Record<string, { bidderId?: BidderId; funding: 'wallet' | 'card' }>;
  steps: Step[];
  expect: Expect[];
  tags?: string[];
}
