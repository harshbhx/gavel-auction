// Mirror of SPEC-web section 5.1 until @gavel/shared exports the same shapes.
// This file and index.ts are the only places that define wire shapes (R-WEB-007).

export const MESSAGE_NAMES = [
  'join',
  'registered',
  'bid',
  'bid_accepted',
  'bid_rejected',
  'price',
  'state',
  'confirm_request',
  'confirm_response',
  'hammer',
  'settlement_update',
  'audit_event',
  'error',
] as const;

export type MessageName = (typeof MESSAGE_NAMES)[number];

export const SETTLEMENT_STATES = [
  'HELD',
  'BIDDING',
  'WINNER_SELECTED',
  'CAPTURING',
  'CAPTURED',
  'VOIDING',
  'SETTLED',
  'FALLBACK_RUNNER_UP',
  'FAILED_NEEDS_REVIEW',
] as const;
export type SettlementState = (typeof SETTLEMENT_STATES)[number];

export const ROOM_STATUSES = [
  'LOBBY',
  'OPEN',
  'PAUSED',
  'CLOSING',
  'SETTLING',
  'DONE',
  'STOPPED',
] as const;
export type RoomStatus = (typeof ROOM_STATUSES)[number];

export const AUCTION_MODES = ['english', 'proxy', 'second_price'] as const;
export type AuctionMode = (typeof AUCTION_MODES)[number];

export const AUDIT_KINDS = [
  'bid',
  'confirm',
  'control',
  'stt_partial',
  'stt_final',
  'parse',
  'settlement',
  'kill',
] as const;
export type AuditKind = (typeof AUDIT_KINDS)[number];

/** Machine code on a rejected bid or an error message, for example over_ceiling or closed. */
export type ErrorCode = string;

export interface Envelope<T extends MessageName> {
  t: T;
  seq: number;
  roomId: string;
  serverTime: number;
}

export interface RoomConfigView {
  minIncrementCents: number;
  reserveCents: number;
  softCloseMs: number;
  maxCeilingCents: number;
  minCeilingCents: number;
  lateEntry: boolean;
  mode: AuctionMode;
}

export interface HoldVerification {
  eventId: string;
  kind: 'webhook' | 'lookup';
  eventType?: string;
  at: number;
}

export interface HoldView {
  paddle: number;
  name: string;
  ceilingCents: number;
  state: SettlementState;
  capturedCents: number;
  releasedCents: number;
  reason?: string;
  verifiedBy: HoldVerification[];
  /** Last 6 characters only. */
  idSuffix: string;
}

export interface SettlementView {
  lotId: string;
  phase: SettlementState;
  winnerPaddle: number | null;
  holds: HoldView[];
  invariants: { ok: boolean; violations: string[] };
}

export interface BidderView {
  paddle: number;
  name: string;
  holdState: SettlementState | 'NONE';
  ceilingCents?: number;
}

export interface RoomSnapshot {
  room: { id: string; name: string; status: RoomStatus; config: RoomConfigView };
  lot: { id: string; title: string; imageUrl?: string; closesAt?: number } | null;
  price: {
    currentCents: number | null;
    leaderPaddle: number | null;
    nextMinCents: number;
    bidCount: number;
  };
  bidders: BidderView[];
  you?: { bidderId: string; paddle: number; ceilingCents: number; holdState: SettlementState };
  settlement?: SettlementView;
}

export type JoinMessage = Envelope<'join'>;
export interface RegisteredMessage extends Envelope<'registered'> {
  bidderId: string;
  paddle: number;
  name: string;
  ceilingCents: number;
}
export interface BidBroadcast extends Envelope<'bid'> {
  paddle: number;
  amountCents: number;
  clientBidId?: string;
}
export interface BidAccepted extends Envelope<'bid_accepted'> {
  clientBidId: string;
  paddle: number;
  amountCents: number;
}
export interface BidRejected extends Envelope<'bid_rejected'> {
  clientBidId: string;
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}
export interface PriceMessage extends Envelope<'price'> {
  currentCents: number | null;
  leaderPaddle: number | null;
  nextMinCents: number;
  bidCount: number;
  closesAt?: number;
}
export interface StateMessage extends Envelope<'state'>, RoomSnapshot {}
export interface ConfirmRequest extends Envelope<'confirm_request'> {
  confirmId: string;
  paddle: number;
  amountCents: number;
  transcript?: string;
  confidence?: number;
  expiresAt: number;
  addressee: 'bidder' | 'auctioneer' | 'both';
}
export interface ConfirmResponseMessage extends Envelope<'confirm_response'> {
  confirmId: string;
  accept: boolean;
}
export interface Hammer extends Envelope<'hammer'> {
  lotId: string;
  winnerPaddle: number | null;
  priceCents: number | null;
  reserveMet: boolean;
}
export interface SettlementUpdate extends Envelope<'settlement_update'> {
  settlement: SettlementView;
}
export interface AuditEvent extends Envelope<'audit_event'> {
  id: string;
  kind: AuditKind;
  at: number;
  audioOffsetMs?: number;
  paddle?: number;
  transcript?: string;
  parsedCents?: number;
  confidence?: number;
  confirmed?: 'yes' | 'no' | 'auto';
  result?: 'accepted' | 'rejected';
  reason?: string;
  raw: unknown;
}
export interface ErrorMessage extends Envelope<'error'> {
  code: ErrorCode;
  message: string;
}

export type ServerMessage =
  | JoinMessage
  | RegisteredMessage
  | BidBroadcast
  | BidAccepted
  | BidRejected
  | PriceMessage
  | StateMessage
  | ConfirmRequest
  | ConfirmResponseMessage
  | Hammer
  | SettlementUpdate
  | AuditEvent
  | ErrorMessage;

export type BidSource = 'qr' | 'manual' | 'voice';

export interface BidSend {
  t: 'bid';
  clientBidId: string;
  paddle: number;
  amountCents: number;
  source: BidSource;
}
export interface JoinSend {
  t: 'join';
  roomId: string;
  resumeFromSeq?: number;
}
export interface ConfirmSend {
  t: 'confirm_response';
  confirmId: string;
  accept: boolean;
}
export type ClientMessage = JoinSend | BidSend | ConfirmSend;
