import { z } from 'zod';
import { BID_SOURCES } from '../enums';
import { isUlid, type BidderId, type BidId } from '../ids';
import { isCents, type Cents } from '../money';
import { EpochMs } from '../time';
import { MAX_REASON_CHARS, MAX_TRANSCRIPT_CHARS } from './envelope';

export const AUDIT_OUTCOMES = ['accepted', 'rejected', 'expired', 'superseded'] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

/** Audit record for one bid attempt, consumed by the ledger and the audit view. */
export const AuditPayloadSchema = z
  .object({
    bidId: z.custom<BidId>(isUlid, 'invalid id'),
    bidderId: z.custom<BidderId>(isUlid, 'invalid id'),
    source: z.enum(BID_SOURCES),
    audioTsMs: z.number().int().nonnegative().optional(),
    /** End of the spoken bid in the audio stream; start is `audioTsMs`. */
    audioEndMs: z.number().int().nonnegative().optional(),
    transcript: z.string().max(MAX_TRANSCRIPT_CHARS).optional(),
    parsedAmount: z.custom<Cents>(isCents, 'must be integer cents').optional(),
    confidence: z.number().min(0).max(1).optional(),
    confirmed: z.boolean().optional(),
    outcome: z.enum(AUDIT_OUTCOMES),
    reason: z.string().max(MAX_REASON_CHARS).optional(),
    serverTs: z
      .number()
      .int()
      .transform((n) => EpochMs(n)),
    seq: z.number().int().positive(),
  })
  .strict();

export type AuditPayload = z.infer<typeof AuditPayloadSchema>;

/**
 * What bidders and screens may see of an audit row: accepted bids only, with no
 * transcript, confidence or reject reason. Rejected rows would reveal ceiling
 * bounds (`over_ceiling` plus the amount) and voice transcripts are personal data.
 */
export const PublicAuditRowSchema = z
  .object({
    bidId: z.custom<BidId>(isUlid, 'invalid id'),
    bidderId: z.custom<BidderId>(isUlid, 'invalid id'),
    source: z.enum(BID_SOURCES),
    parsedAmount: z.custom<Cents>(isCents, 'must be integer cents').optional(),
    outcome: z.literal('accepted'),
    serverTs: z
      .number()
      .int()
      .transform((n) => EpochMs(n)),
    seq: z.number().int().positive(),
  })
  .strict();

export type PublicAuditRow = z.infer<typeof PublicAuditRowSchema>;

/** The public view of one audit row, or null when the row must not be shown. */
export function toPublicAudit(row: AuditPayload): PublicAuditRow | null {
  if (row.outcome !== 'accepted') return null;
  const out: PublicAuditRow = {
    bidId: row.bidId,
    bidderId: row.bidderId,
    source: row.source,
    outcome: 'accepted',
    serverTs: row.serverTs,
    seq: row.seq,
  };
  if (row.parsedAmount !== undefined) out.parsedAmount = row.parsedAmount;
  return out;
}
