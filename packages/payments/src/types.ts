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
  | 'auth_unavailable'
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
  /** Set only when PayPal reports the capture as REFUNDED or PARTIALLY_REFUNDED. */
  refund?: { status: 'REFUNDED' | 'PARTIALLY_REFUNDED'; refundedCents?: number };
  /**
   * Set only when PayPal reports the capture as PENDING (R11-O03): the money is not taken
   * yet and PayPal may still decline it, so it is never adopted as the sale.
   */
  pending?: boolean;
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
  /**
   * Captures PayPal declined or failed (R11-O03). They took no money and are not in
   * `captures`; set only when the order lists at least one.
   */
  declined?: CaptureRef[];
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
  /** The PayPal order of the hold; lets truth reads observe captures (R8-P01). */
  orderId?: string;
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
  /** Authorization ids replaced by a reauthorization, oldest first (R11-O06). */
  priorAuthIds?: string[];
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
  /** The PayPal order of the hold, so a resume can read its captures (R8-P01). */
  orderId?: string;
  /**
   * Authorization ids this hold had before a reauthorization replaced them, oldest first
   * (R11-O06). Kept for the audit; `authId` is the one PayPal holds the funds under.
   */
  priorAuthIds?: string[];
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
