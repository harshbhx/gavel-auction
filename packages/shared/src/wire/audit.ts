import { z } from 'zod';
import { BID_SOURCES } from '../enums';
import { isUlid, type BidderId, type BidId } from '../ids';
import { isCents, type Cents } from '../money';
import { EpochMs } from '../time';

export const AUDIT_OUTCOMES = ['accepted', 'rejected', 'expired', 'superseded'] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

/** Audit record for one bid attempt, consumed by the ledger and the audit view. */
export const AuditPayloadSchema = z
  .object({
    bidId: z.custom<BidId>(isUlid, 'invalid id'),
    bidderId: z.custom<BidderId>(isUlid, 'invalid id'),
    source: z.enum(BID_SOURCES),
    audioTsMs: z.number().int().nonnegative().optional(),
    transcript: z.string().optional(),
    parsedAmount: z.custom<Cents>(isCents, 'must be integer cents').optional(),
    confidence: z.number().min(0).max(1).optional(),
    confirmed: z.boolean().optional(),
    outcome: z.enum(AUDIT_OUTCOMES),
    reason: z.string().optional(),
    serverTs: z
      .number()
      .int()
      .transform((n) => EpochMs(n)),
    seq: z.number().int().positive(),
  })
  .strict();

export type AuditPayload = z.infer<typeof AuditPayloadSchema>;
