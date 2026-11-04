import { z } from 'zod';
import { BID_SOURCES } from '../enums';
import { isUlid, type AuctionId, type BidderId, type MsgId } from '../ids';
import { EpochMs } from '../time';
import {
  MAX_NAME_CHARS,
  MAX_TRANSCRIPT_CHARS,
  decodeFrame,
  message,
  type FrameResult,
} from './envelope';

const ulid = <T extends string>() => z.custom<T>(isUlid, 'invalid id');

export const JoinSchema = message('join', {
  token: z.string().min(1),
  auctionId: ulid<AuctionId>(),
  lastSeq: z.number().int().nonnegative().optional(),
  client: z
    .object({ name: z.string().max(MAX_NAME_CHARS), version: z.string().max(32) })
    .strict()
    .optional(),
});

export const BidSchema = message('bid', {
  mid: ulid<MsgId>(),
  // Any finite number decodes; the room maps a non-cent value to bid_rejected
  // bad_amount instead of closing the socket with bad_message.
  amount: z.number().refine(Number.isFinite, 'must be a finite number'),
  source: z.enum(BID_SOURCES),
  bidderId: ulid<BidderId>().optional(),
  transcript: z.string().max(MAX_TRANSCRIPT_CHARS).optional(),
  confidence: z.number().min(0).max(1).optional(),
  ambiguous: z.boolean().optional(),
  audioTsMs: z.number().int().nonnegative().optional(),
  clientTs: z
    .number()
    .int()
    .transform((n) => EpochMs(n))
    .optional(),
});

export const ConfirmResponseSchema = message('confirm_response', {
  confirmId: z.string().min(1).max(64),
  accept: z.boolean(),
});

/** The only message types accepted from a client. */
export const clientSchemas = {
  join: JoinSchema,
  bid: BidSchema,
  confirm_response: ConfirmResponseSchema,
} as const;

export type JoinMsg = z.infer<typeof JoinSchema>;
export type BidMsg = z.infer<typeof BidSchema>;
export type ConfirmResponseMsg = z.infer<typeof ConfirmResponseSchema>;
export type ClientMsg = JoinMsg | BidMsg | ConfirmResponseMsg;

/** Decode one client frame. Never throws. */
export function decodeClientMsg(raw: string | Uint8Array): FrameResult<ClientMsg> {
  return decodeFrame(raw, clientSchemas);
}
