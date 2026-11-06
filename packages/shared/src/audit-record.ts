import { z } from 'zod';
import { BID_SOURCES } from './enums';
import type { RoomEvent } from './events';
import { isUlid, type BidderId } from './ids';
import { isCents, type Cents } from './money';
import { AUDIT_OUTCOMES, type AuditPayload } from './wire/audit';
import { MAX_REASON_CHARS, MAX_TRANSCRIPT_CHARS } from './wire/envelope';

const MAX_BPS = 10_000;

/**
 * Confidence 0..1 to integer basis points 0..10000. The single conversion point: a float such as
 * 0.07 gives 700, never 700.0000000000001. NaN and out-of-range values clamp.
 */
export function confidenceToBps(fraction: number): number {
  if (Number.isNaN(fraction)) return 0;
  return Math.min(MAX_BPS, Math.max(0, Math.round(fraction * MAX_BPS)));
}

export const BID_AUDIT_OUTCOMES = [...AUDIT_OUTCOMES, 'pending_confirm', 'dropped'] as const;
export type BidAuditOutcome = (typeof BID_AUDIT_OUTCOMES)[number];

/**
 * The one audit record of a bid attempt or a voice decision (docs/PLAN.md 2.4): who, what was
 * heard, when in the audio, how sure, whether confirmed, and what became of it. Voice, wire and
 * engine each hold a subset; this is the shape they convert to.
 */
export const BidAuditRecordSchema = z
  .object({
    bidderId: z.custom<BidderId>(isUlid, 'invalid id').optional(),
    source: z.enum(BID_SOURCES),
    audioStartMs: z.number().int().nonnegative().optional(),
    audioEndMs: z.number().int().nonnegative().optional(),
    transcript: z.string().max(MAX_TRANSCRIPT_CHARS).optional(),
    confidenceBps: z.number().int().min(0).max(MAX_BPS).optional(),
    parsedCents: z.custom<Cents>(isCents, 'must be integer cents').optional(),
    confirmed: z.boolean(),
    outcome: z.enum(BID_AUDIT_OUTCOMES),
    reason: z.string().max(MAX_REASON_CHARS).optional(),
    seq: z.number().int().positive(),
    serverTs: z.number().int(),
  })
  .strict();
export type BidAuditRecord = z.infer<typeof BidAuditRecordSchema>;

/** The record for a persisted audit payload. Pure; no field is invented. */
export function toBidAuditRecord(
  audit: AuditPayload,
  outcome: BidAuditOutcome = audit.outcome,
): BidAuditRecord {
  const out: BidAuditRecord = {
    bidderId: audit.bidderId,
    source: audit.source,
    confirmed: audit.confirmed === true,
    outcome,
    seq: audit.seq,
    serverTs: audit.serverTs,
  };
  if (audit.audioTsMs !== undefined) out.audioStartMs = audit.audioTsMs;
  if (audit.audioEndMs !== undefined) out.audioEndMs = audit.audioEndMs;
  if (audit.transcript !== undefined) out.transcript = audit.transcript;
  if (audit.confidence !== undefined) out.confidenceBps = confidenceToBps(audit.confidence);
  if (audit.parsedAmount !== undefined) out.parsedCents = audit.parsedAmount;
  if (audit.reason !== undefined) out.reason = audit.reason;
  return out;
}

/** The audit records an event log holds, in log order; events with no audit row give none. */
export function auditRecordsFromEvents(events: readonly RoomEvent[]): BidAuditRecord[] {
  const out: BidAuditRecord[] = [];
  for (const e of events) {
    switch (e.type) {
      case 'bid_accepted':
      case 'bid_rejected':
        out.push(toBidAuditRecord(e.audit));
        break;
      case 'confirm_requested':
        out.push(toBidAuditRecord(e.audit, 'pending_confirm'));
        break;
      case 'confirm_resolved':
        out.push(toBidAuditRecord(e.audit, e.outcome));
        break;
      case 'voice_dropped': {
        const d = e.drop;
        const rec: BidAuditRecord = {
          source: 'voice',
          confirmed: false,
          outcome: 'dropped',
          confidenceBps: d.confidenceBps,
          reason: d.reason,
          seq: e.seq,
          serverTs: e.ts,
        };
        if (d.bidderId !== undefined) rec.bidderId = d.bidderId;
        if (d.audioStartMs !== undefined) rec.audioStartMs = d.audioStartMs;
        if (d.audioEndMs !== undefined) rec.audioEndMs = d.audioEndMs;
        if (d.parsedCents !== undefined) rec.parsedCents = d.parsedCents;
        out.push(rec);
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/** What a bidder or screen may see of a record: accepted bids only, with no private data. */
export interface PublicBidAuditRecord {
  bidderId?: BidderId;
  source: BidAuditRecord['source'];
  parsedCents?: Cents;
  outcome: 'accepted';
  seq: number;
  serverTs: number;
}

export function toPublicBidAuditRecord(rec: BidAuditRecord): PublicBidAuditRecord | null {
  if (rec.outcome !== 'accepted') return null;
  const out: PublicBidAuditRecord = {
    source: rec.source,
    outcome: 'accepted',
    seq: rec.seq,
    serverTs: rec.serverTs,
  };
  if (rec.bidderId !== undefined) out.bidderId = rec.bidderId;
  if (rec.parsedCents !== undefined) out.parsedCents = rec.parsedCents;
  return out;
}
