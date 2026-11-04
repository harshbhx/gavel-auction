export type HoldStatus =
  | 'PENDING_APPROVAL'
  | 'HELD'
  | 'CAPTURED'
  | 'VOIDED'
  | 'EXPIRED'
  | 'DENIED'
  | 'UNKNOWN';

export const SETTLEMENT_STATES = [
  'HELD',
  'BIDDING',
  'WINNER_SELECTED',
  'CAPTURING',
  'FALLBACK_RUNNER_UP',
  'CAPTURED',
  'VOIDING',
  'SETTLED',
  'FAILED_NEEDS_REVIEW',
] as const;
export type SettlementState = (typeof SETTLEMENT_STATES)[number];

export type ErrorKind =
  | 'network'
  | 'rate_limited'
  | 'server_error'
  | 'auth_expired'
  | 'auth_failed'
  | 'not_found'
  | 'invalid_request'
  | 'already_voided'
  | 'expired'
  | 'already_captured'
  | 'declined'
  | 'idempotency_conflict'
  | 'rejected'
  | 'kill_switch_engaged'
  | 'ceiling_out_of_range';

export type Outcome = 'definite' | 'unknown';

export interface CaptureRef {
  captureId: string;
  amountCents: number;
  final: boolean;
  invoiceId?: string;
}

export interface HoldTruth {
  holdId: string;
  authId: string;
  status:
    | 'CREATED'
    | 'PENDING'
    | 'PARTIALLY_CAPTURED'
    | 'CAPTURED'
    | 'VOIDED'
    | 'EXPIRED'
    | 'DENIED'
    | 'NOT_FOUND';
  amountCents: number;
  capturedCents: number;
  /** null means not observable (UNVERIFIED G1). */
  captures: CaptureRef[] | null;
  observedAtMs: number;
}

export interface Candidate {
  bidderId: string;
  priceCents: number;
}

export interface HoldRef {
  holdId: string;
  authId: string;
  ceilingCents: number;
  createdAtMs: number;
}

export interface SettlementPlan {
  auctionId: string;
  reserveCents: number;
  /** Best first; index 0 is the hammer winner. */
  candidates: Candidate[];
  /** bidderId -> hold */
  holds: Record<string, HoldRef>;
}

export interface HoldRecord {
  holdId: string;
  auctionId: string;
  bidderId: string;
  orderId: string;
  authId?: string;
  ceilingCents: number;
  status: HoldStatus;
  createdAtMs: number;
  stale?: boolean;
}

export interface StoredWebhook {
  id: string;
  eventType: string;
  receivedAtMs: number;
  body: string;
  result?: string;
  parkedUntilMs?: number;
}

export interface KillState {
  engaged: boolean;
  reason?: string;
  by?: string;
  sinceMs?: number;
}

export interface PaymentAudit {
  kind: 'paypal_call' | 'state_change' | 'kill_switch' | 'stale_hold' | 'void_all';
  auctionId?: string;
  holdId?: string;
  op?: string;
  requestId?: string;
  attempt?: number;
  status?: number;
  outcome?: Outcome;
  debugId?: string;
  from?: string;
  to?: string;
  label?: string;
  actor?: string;
  tsMs: number;
}

export interface JournalHold {
  holdId: string;
  authId: string;
  ceilingCents: number;
  /** When the hold was created; lets a resume compute its age (R-PAY-034). */
  createdAtMs?: number;
  stale: boolean;
}

export interface JournalIntent {
  op: 'capture' | 'void' | 'reauth';
  holdId: string;
  requestId: string;
  amountCents: number;
  startedAtMs: number;
}

export interface JournalHistoryEntry {
  seq: number;
  tsMs: number;
  from: SettlementState;
  to: SettlementState;
  label: string;
}

export interface JournalWinner {
  bidderId: string;
  holdId: string;
  captureId: string;
  amountCents: number;
}

export interface JournalFailure {
  bidderId: string;
  reason: string;
}

export interface Journal {
  v: 1;
  auctionId: string;
  version: number;
  state: SettlementState;
  plan: { reserveCents: number; candidates: Candidate[] };
  holds: Record<string, JournalHold>;
  cursor: number;
  intent: JournalIntent | null;
  unknownSince: number | null;
  winner: JournalWinner | null;
  failed: JournalFailure[];
  voids: Record<string, string>;
  resumes: number;
  history: JournalHistoryEntry[];
}

function canon(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canon);
  if (value !== null && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) {
      const v = src[k];
      if (v !== undefined) out[k] = canon(v);
    }
    return out;
  }
  return value;
}

/** Canonical JSON: sorted keys, no whitespace, undefined fields omitted. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canon(value));
}
