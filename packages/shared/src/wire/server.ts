import { z } from 'zod';
import { AUCTION_STATUSES, SETTLEMENT_STATES } from '../enums';
import { ERROR_CODES } from '../errors';
import { isUlid, type AuctionId, type BidderId, type BidId, type MsgId } from '../ids';
import { AuctionConfigSchema } from '../config-schema';
import { isCents, type Cents } from '../money';
import { EpochMs } from '../time';
import { scrubMessage } from '../api-error';
import { HOLD_STATUSES } from '../hold-contract';
import { AuditPayloadSchema, PublicAuditRowSchema } from './audit';
import {
  MAX_BIDDERS_PER_ROOM,
  MAX_NAME_CHARS,
  MAX_NOTE_CHARS,
  MAX_PADDLE,
  MAX_SERVER_FRAME_BYTES,
  MAX_TRANSCRIPT_CHARS,
  decodeFrame,
  message,
  type FrameResult,
} from './envelope';

const ulid = <T extends string>() => z.custom<T>(isUlid, 'invalid id');
const cents = () => z.custom<Cents>(isCents, 'must be integer cents');
const epochMs = () =>
  z
    .number()
    .int()
    .transform((n) => EpochMs(n));
const seq = z.number().int().positive();
const settlementState = z.enum(SETTLEMENT_STATES);
const errorCode = z.enum(ERROR_CODES);
const MAX_ERROR_MESSAGE_CHARS = 300;
const paddle = z.number().int().min(1).max(MAX_PADDLE);

/** The auctioneer sees full rows; everyone else sees public rows only. */
const auditRow = z.union([AuditPayloadSchema, PublicAuditRowSchema]);

const hasUnique = (items: readonly object[], key: 'paddle' | 'bidderId'): boolean => {
  const seen = new Set<unknown>();
  for (const item of items) {
    const value = (item as Record<string, unknown>)[key];
    if (seen.has(value)) return false;
    seen.add(value);
  }
  return true;
};

/** Longest lot title a snapshot carries. */
const MAX_LOT_TITLE_CHARS = 120;

/** Fields every server frame after a successful join carries. */
const ev = { seq, ts: epochMs() };

export const RoomSnapshotSchema = z
  .object({
    auctionId: ulid<AuctionId>(),
    config: AuctionConfigSchema,
    status: z.enum(AUCTION_STATUSES),
    price: cents().nullable(),
    leaderId: ulid<BidderId>().nullable(),
    endTs: epochMs(),
    minNext: cents(),
    paused: z.boolean().optional(),
    remainingMs: z.number().int().nonnegative().optional(),
    /** True once the auctioneer ended the lot (hammer or kill switch) instead of the timer. */
    stopped: z.boolean().optional(),
    /** True once the room no longer takes registrations (the lot was hammered or the auction is done). */
    registrationClosed: z.boolean().optional(),
    /** Public lot title, set by the HTTP snapshot route; never carries private data. */
    lotTitle: z.string().max(MAX_LOT_TITLE_CHARS).optional(),
    /** Short human join code of the auction, set by the HTTP snapshot route. */
    joinCode: z.string().min(4).max(12).optional(),
    roster: z
      .array(
        z
          .object({
            bidderId: ulid<BidderId>(),
            paddle,
            name: z.string().max(MAX_NAME_CHARS),
            hold: z.enum(['HELD', 'NONE']),
          })
          .strict(),
      )
      .max(MAX_BIDDERS_PER_ROOM)
      .refine((r) => hasUnique(r, 'paddle') && hasUnique(r, 'bidderId'), 'duplicate paddle or id'),
    recentAudit: z.array(auditRow).max(50),
    settlement: z
      .object({
        rev: z.number().int(),
        auctionState: settlementState,
        you: settlementState.optional(),
      })
      .strict()
      .optional(),
    you: z
      .object({
        bidderId: ulid<BidderId>(),
        ceiling: cents(),
        /** This bidder's highest accepted amount, absent before their first accepted bid. */
        highBid: cents().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const RegisteredSchema = message('registered', {
  ...ev,
  bidderId: ulid<BidderId>(),
  paddle,
  ceiling: cents().optional(),
  role: z.enum(['auctioneer', 'bidder', 'screen']),
});

export const BidAcceptedSchema = message('bid_accepted', {
  ...ev,
  mid: ulid<MsgId>(),
  bidId: ulid<BidId>(),
  amount: cents(),
});

export const BidRejectedSchema = message('bid_rejected', {
  ...ev,
  mid: ulid<MsgId>(),
  reason: errorCode,
  retryable: z.boolean(),
  retryAfterMs: z.number().int().nonnegative().optional(),
});

export const PriceSchema = message('price', {
  ...ev,
  price: cents(),
  leaderId: ulid<BidderId>().nullable(),
  leaderPaddle: paddle.nullable(),
  endTs: epochMs(),
  minNext: cents(),
  extensions: z.number().int().nonnegative(),
  /** True while the auctioneer has frozen the lot clock; `remainingMs` is what resume restores. */
  paused: z.boolean().optional(),
  remainingMs: z.number().int().nonnegative().optional(),
});

export const StateSchema = message('state', { ...ev, snapshot: RoomSnapshotSchema });

export const ConfirmRequestSchema = message('confirm_request', {
  ...ev,
  confirmId: z.string().min(1).max(64),
  amount: cents(),
  transcript: z.string().max(MAX_TRANSCRIPT_CHARS).optional(),
  expiresAt: epochMs(),
});

export const HammerSchema = message('hammer', {
  ...ev,
  winnerId: ulid<BidderId>().nullable(),
  price: cents(),
  ranking: z
    .array(z.object({ bidderId: ulid<BidderId>(), amount: cents() }).strict())
    .max(MAX_BIDDERS_PER_ROOM),
  /** True when the auctioneer ended the lot; absent when the timer did. */
  stopped: z.boolean().optional(),
  /** True on the hammer frame: registration closes with the hammer. */
  registrationClosed: z.boolean().optional(),
});

/** One hold in the settlement ladder. Amounts are integer cents; idSuffix is the last 6 characters only. */
const settlementHold = z
  .object({
    paddle,
    state: settlementState,
    capturedCents: z.number().int().nonnegative(),
    releasedCents: z.number().int().nonnegative(),
    idSuffix: z.string().max(6),
    verifiedBy: z
      .array(
        z
          .object({
            eventId: z.string().max(64),
            kind: z.enum(['webhook', 'lookup']),
            eventType: z.string().max(64).optional(),
            at: z.number().int(),
          })
          .strict(),
      )
      .max(10),
  })
  .strict();

/** What happened to the part of a captured hold beyond the price (none when nothing is left). */
export const REMAINDER_STATES = ['none', 'pending', 'released', 'unreleased'] as const;
export type RemainderState = (typeof REMAINDER_STATES)[number];

/**
 * The viewer's own hold after the hammer (`yourHold`). The server builds it per connection and
 * sends it only to the bidder named by `bidderId`; screens, the auctioneer and other bidders
 * never receive it, so no viewer learns another bidder's hold or ceiling.
 */
export const OwnHoldSchema = z
  .object({
    bidderId: ulid<BidderId>(),
    /** Last 6 characters of the hold id only. */
    idSuffix: z.string().max(6),
    status: z.enum(HOLD_STATUSES),
    /** What the hold reserves: this bidder's own ceiling. */
    ceilingCents: cents(),
    capturedCents: z.number().int().nonnegative(),
    releasedCents: z.number().int().nonnegative(),
    remainder: z.enum(REMAINDER_STATES),
  })
  .strict();
export type OwnHold = z.infer<typeof OwnHoldSchema>;

export const SettlementUpdateSchema = message('settlement_update', {
  ...ev,
  rev: z.number().int(),
  auctionState: settlementState,
  you: settlementState.optional(),
  amountCaptured: cents().optional(),
  note: z.string().max(MAX_NOTE_CHARS).optional(),
  /** Per-hold detail for the ladder. Older servers omit these three fields; clients must cope. */
  holds: z.array(settlementHold).max(MAX_BIDDERS_PER_ROOM).optional(),
  winnerPaddle: paddle.nullable().optional(),
  invariants: z
    .object({ ok: z.boolean(), violations: z.array(z.string().max(120)).max(20) })
    .strict()
    .optional(),
  /**
   * Public-safe ladder summary for every screen: how many holds sit in each settlement state.
   * No names, paddles, amounts or hold ids; the per-hold lanes stay with their owner.
   */
  ladder: z
    .object({ counts: z.record(settlementState, z.number().int().nonnegative()) })
    .strict()
    .optional(),
  /** The receiving bidder's own hold. Absent for screens, the auctioneer and older servers. */
  yourHold: OwnHoldSchema.optional(),
});

export const AuditEventSchema = message('audit_event', { ...ev, audit: auditRow });

/** `seq` is omitted on errors that have no event behind them. */
export const ErrorSchema = message('error', {
  code: errorCode,
  // Scrubbed so a bearer token or stack line in an internal message never reaches a client.
  message: z.string().transform((m) => scrubMessage(m).slice(0, MAX_ERROR_MESSAGE_CHARS)),
  retryAfterMs: z.number().int().nonnegative().optional(),
  seq: seq.optional(),
});

export const serverSchemas = {
  registered: RegisteredSchema,
  bid_accepted: BidAcceptedSchema,
  bid_rejected: BidRejectedSchema,
  price: PriceSchema,
  state: StateSchema,
  confirm_request: ConfirmRequestSchema,
  hammer: HammerSchema,
  settlement_update: SettlementUpdateSchema,
  audit_event: AuditEventSchema,
  error: ErrorSchema,
} as const;

export type RoomSnapshot = z.infer<typeof RoomSnapshotSchema>;
export type RegisteredMsg = z.infer<typeof RegisteredSchema>;
export type BidAcceptedMsg = z.infer<typeof BidAcceptedSchema>;
export type BidRejectedMsg = z.infer<typeof BidRejectedSchema>;
export type PriceMsg = z.infer<typeof PriceSchema>;
export type StateMsg = z.infer<typeof StateSchema>;
export type ConfirmRequestMsg = z.infer<typeof ConfirmRequestSchema>;
export type HammerMsg = z.infer<typeof HammerSchema>;
export type SettlementUpdateMsg = z.infer<typeof SettlementUpdateSchema>;
export type AuditEventMsg = z.infer<typeof AuditEventSchema>;
export type ErrorMsg = z.infer<typeof ErrorSchema>;
export type ServerMsg = z.infer<(typeof serverSchemas)[keyof typeof serverSchemas]>;

/** Decode one server frame. Never throws. */
export function decodeServerMsg(raw: string | Uint8Array): FrameResult<ServerMsg> {
  return decodeFrame(raw, serverSchemas, MAX_SERVER_FRAME_BYTES);
}
