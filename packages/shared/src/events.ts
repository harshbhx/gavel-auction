import { z } from 'zod';
import { BID_SOURCES, SETTLEMENT_STATES } from './enums';
import { AuctionConfigSchema } from './config-schema';
import { ERROR_CODES, GavelError } from './errors';
import { isUlid, type AuctionId, type BidderId, type BidId, type MsgId } from './ids';
import { isCents, type Cents } from './money';
import { EpochMs } from './time';
import { AuditPayloadSchema } from './wire/audit';
import { MAX_NAME_CHARS, MAX_REASON_CHARS } from './wire/envelope';

export const MAX_HOLD_REF_CHARS = 128;

const ulid = <T extends string>() => z.custom<T>(isUlid, 'invalid id');
const cents = () => z.custom<Cents>(isCents, 'must be integer cents');
const epochMs = () =>
  z
    .number()
    .int()
    .transform((n) => EpochMs(n));
const settlementState = z.enum(SETTLEMENT_STATES);

/** Fields every persisted record carries. */
const base = {
  auctionId: ulid<AuctionId>(),
  seq: z.number().int().positive(),
  ts: epochMs(),
};

function record<T extends string, S extends z.ZodRawShape>(type: T, shape: S) {
  return z.object({ ...base, type: z.literal(type), ...shape }).strict();
}

export const CONTROL_ACTIONS = ['open', 'pause', 'resume', 'extend', 'hammer'] as const;
export type ControlAction = (typeof CONTROL_ACTIONS)[number];

export const AuctionCreatedEvent = record('auction_created', {
  config: AuctionConfigSchema,
  auctioneerSub: z.string().min(1),
  /**
   * The ceiling cap in force when the auction was created (event schema v2). Replay builds the
   * engine with this value, not the current environment. Logs written before this field existed
   * do not carry it: replay then uses the process cap, which defaults to DEFAULT_MAX_CEILING_CENTS.
   */
  maxCeilingCents: cents().optional(),
});

export const BidderRegisteredEvent = record('bidder_registered', {
  bidderId: ulid<BidderId>(),
  paddle: z.number().int(),
  name: z.string().min(1).max(MAX_NAME_CHARS),
  ceiling: cents(),
  holdRef: z.string().min(1).max(MAX_HOLD_REF_CHARS),
});

/**
 * A bidder replaced their hold with a larger one: the private ceiling goes up to `ceiling` and the
 * roster entry follows `holdRef`. Only raises are logged; a limit never goes down (D-0025).
 */
export const CeilingRaisedEvent = record('ceiling_raised', {
  bidderId: ulid<BidderId>(),
  from: cents(),
  ceiling: cents(),
  holdRef: z.string().min(1).max(MAX_HOLD_REF_CHARS),
});

export const BidAcceptedEvent = record('bid_accepted', {
  bidId: ulid<BidId>(),
  bidderId: ulid<BidderId>(),
  mid: ulid<MsgId>(),
  amount: cents(),
  source: z.enum(BID_SOURCES),
  audit: AuditPayloadSchema,
  endTsAfter: epochMs(),
});

export const BidRejectedEvent = record('bid_rejected', {
  bidderId: ulid<BidderId>(),
  mid: ulid<MsgId>(),
  amount: cents().optional(),
  reason: z.enum(ERROR_CODES),
  audit: AuditPayloadSchema,
});

export const ConfirmRequestedEvent = record('confirm_requested', {
  confirmId: z.string().min(1),
  bidderId: ulid<BidderId>(),
  mid: ulid<MsgId>(),
  amount: cents(),
  expiresAt: epochMs(),
  audit: AuditPayloadSchema,
});

export const ConfirmResolvedEvent = record('confirm_resolved', {
  confirmId: z.string().min(1),
  outcome: z.enum(['accepted', 'rejected', 'expired', 'superseded']),
  audit: AuditPayloadSchema,
});

/**
 * A spoken utterance that never became a bid or a confirm: hedged, no bidder, a question.
 * Kept so the audit trail has every voice decision (R-VOX-071). The transcript is never stored.
 */
export const VoiceDroppedEvent = record('voice_dropped', {
  drop: z
    .object({
      segmentId: z.string().min(1).max(64),
      audioStartMs: z.number().int().nonnegative().optional(),
      audioEndMs: z.number().int().nonnegative().optional(),
      confidenceBps: z.number().int().min(0).max(10_000),
      reason: z.string().min(1).max(MAX_REASON_CHARS),
      bidderId: ulid<BidderId>().optional(),
      parsedCents: cents().optional(),
    })
    .strict(),
});

export const ControlEvent = record('control', {
  controlId: z.string().min(1),
  action: z.enum(CONTROL_ACTIONS),
  by: z.string().min(1),
  args: z.record(z.number()).optional(),
  audit: AuditPayloadSchema,
});

export const StateChangedEvent = record('state_changed', {
  from: z.string(),
  to: z.string(),
  endTs: epochMs(),
});

export const HammeredEvent = record('hammered', {
  winnerId: ulid<BidderId>().nullable(),
  price: cents(),
  ranking: z.array(z.object({ bidderId: ulid<BidderId>(), amount: cents() }).strict()),
});

/** A bidder's hold can no longer be charged, so their ceiling is revoked before the hammer. */
export const CeilingRevokedEvent = record('ceiling_revoked', {
  bidderId: ulid<BidderId>(),
  reason: z.enum(['declined', 'expired', 'voided']),
});

export const SettleRequestedEvent = record('settle_requested', {});

export const SettlementUpdateEvent = record('settlement_update', {
  rev: z.number().int(),
  auctionState: settlementState,
  perBidder: z.record(settlementState),
  amountCaptured: cents().optional(),
  note: z.string().optional(),
});

/** Persisted log record: the contract between room, store and replay (R-RT-020). */
export const RoomEventSchema = z.discriminatedUnion('type', [
  AuctionCreatedEvent,
  BidderRegisteredEvent,
  CeilingRaisedEvent,
  BidAcceptedEvent,
  BidRejectedEvent,
  ConfirmRequestedEvent,
  ConfirmResolvedEvent,
  VoiceDroppedEvent,
  ControlEvent,
  StateChangedEvent,
  HammeredEvent,
  CeilingRevokedEvent,
  SettleRequestedEvent,
  SettlementUpdateEvent,
]);

export type RoomEvent = z.infer<typeof RoomEventSchema>;
export type RoomEventType = RoomEvent['type'];

/**
 * Throws `conflict` unless `seq` runs 1, 2, 3, ... without a gap or repeat.
 * `startSeq` is the seq the first event must carry (default 1).
 */
export function assertGapless(events: readonly { seq: number }[], startSeq = 1): void {
  let expected = startSeq;
  for (const e of events) {
    if (e.seq !== expected) {
      throw new GavelError('conflict', `seq gap: expected ${expected}, got ${e.seq}`);
    }
    expected += 1;
  }
}
