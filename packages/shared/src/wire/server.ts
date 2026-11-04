import { z } from 'zod';
import { AUCTION_STATUSES, SETTLEMENT_STATES } from '../enums';
import { ERROR_CODES } from '../errors';
import { isUlid, type AuctionId, type BidderId, type BidId, type MsgId } from '../ids';
import { AuctionConfigSchema } from '../config-schema';
import { isCents, type Cents } from '../money';
import { EpochMs } from '../time';
import { AuditPayloadSchema } from './audit';
import { decodeFrame, message, type FrameResult } from './envelope';

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
    roster: z.array(
      z
        .object({
          bidderId: ulid<BidderId>(),
          paddle: z.number().int(),
          name: z.string(),
          hold: z.enum(['HELD', 'NONE']),
        })
        .strict(),
    ),
    recentAudit: z.array(AuditPayloadSchema).max(50),
    settlement: z
      .object({
        rev: z.number().int(),
        auctionState: settlementState,
        you: settlementState.optional(),
      })
      .strict()
      .optional(),
    you: z.object({ bidderId: ulid<BidderId>(), ceiling: cents() }).strict().optional(),
  })
  .strict();

export const RegisteredSchema = message('registered', {
  ...ev,
  bidderId: ulid<BidderId>(),
  paddle: z.number().int(),
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
  leaderPaddle: z.number().int().nullable(),
  endTs: epochMs(),
  minNext: cents(),
  extensions: z.number().int().nonnegative(),
});

export const StateSchema = message('state', { ...ev, snapshot: RoomSnapshotSchema });

export const ConfirmRequestSchema = message('confirm_request', {
  ...ev,
  confirmId: z.string().min(1),
  amount: cents(),
  transcript: z.string().optional(),
  expiresAt: epochMs(),
});

export const HammerSchema = message('hammer', {
  ...ev,
  winnerId: ulid<BidderId>().nullable(),
  price: cents(),
  ranking: z.array(z.object({ bidderId: ulid<BidderId>(), amount: cents() }).strict()),
});

export const SettlementUpdateSchema = message('settlement_update', {
  ...ev,
  rev: z.number().int(),
  auctionState: settlementState,
  you: settlementState.optional(),
  amountCaptured: cents().optional(),
  note: z.string().optional(),
});

export const AuditEventSchema = message('audit_event', { ...ev, audit: AuditPayloadSchema });

/** `seq` is omitted on errors that have no event behind them. */
export const ErrorSchema = message('error', {
  code: errorCode,
  message: z.string(),
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
  return decodeFrame(raw, serverSchemas);
}
