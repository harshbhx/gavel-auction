import { z } from 'zod';

/** Integer cents. */
export type Cents = number;

export const VOICE_REASONS = [
  'ok',
  'empty',
  'no_amount',
  'question',
  'auctioneer_talk',
  'negation',
  'withdraw',
  'correction',
  'retract',
  'hedged',
  'multiple_amounts',
  'multiple_bidders',
  'uninterpretable_number',
  'unknown_bidder',
  'unregistered_paddle',
  'homophone',
  'to_for_ambiguity',
  'unsupported_currency',
  'fractional_amount',
  'implausible_amount',
  'large_jump',
  'below_minimum',
  'above_ceiling',
  'not_open',
  'already_high_bidder',
  'duplicate',
  'low_confidence',
  'llm_disagree',
  'too_long',
  'garbage',
  'stt_unavailable',
  'prompt_rate_limited',
  'stale_segment',
] as const;
export type VoiceReason = (typeof VOICE_REASONS)[number];

export const PARSE_FLAGS = ['asr_repair', 'colloquial_hundreds', 'make_it', 'correction'] as const;
export type ParseFlag = (typeof PARSE_FLAGS)[number];

/** Paddle "12" or a bidder id. */
export interface BidderRef {
  kind: 'paddle' | 'speaker';
  value: string;
}

export interface Candidate {
  bidder: BidderRef | null;
  amountCents: Cents | null;
}

export interface ParseResult {
  status: 'bid' | 'confirm' | 'none';
  bidder: BidderRef | null;
  amountCents: Cents | null;
  reason: VoiceReason;
  /** Alternatives sorted by amount then paddle; empty when status is 'bid'. */
  candidates: Candidate[];
  flags: ParseFlag[];
  /** 0..1 */
  confidence: number;
  source: 'rules' | 'llm' | 'merged';
  /** Offsets in the input text. */
  spans?: Array<{ kind: 'amount' | 'paddle'; start: number; end: number }>;
}

export interface ParseContext {
  speakerBidderId?: string;
  /** The paddle of the speaker, when the roster knows it; lets a speaker match a paddle-named bid. */
  speakerPaddle?: string;
  currentPriceCents?: Cents;
  minIncrementCents?: Cents;
  sttWordConfidence?: Array<{ word: string; start: number; end: number; confidence: number }>;
  pendingCandidate?: {
    id: string;
    bidder: BidderRef | null;
    amountCents: Cents;
    ageMs: number;
  };
}

export interface BidContext {
  nowMs: number;
  lotState: 'OPEN' | 'CLOSING' | 'OTHER';
  currentPriceCents: Cents;
  minIncrementCents: Cents;
  highBidderId: string | null;
  /** Keyed by paddle. */
  roster: Map<string, { bidderId: string; ceilingCents: Cents; holdActive: boolean }>;
  recent: Array<{ bidderId: string; amountCents: Cents; atMs: number }>;
}

export interface VoiceEvidence {
  segmentId: string;
  /** `${roomId}:${lotId}:${audioStartMs}:${sha1(text).slice(0,12)}` */
  idempotencyKey: string;
  transcript: string;
  audioStartMs: number;
  audioEndMs: number;
  sttProvider: string;
  sttConfidence: number;
  replay: boolean;
  rules: ParseResult;
  llm: ParseResult | null;
  confidence: number;
  reason: VoiceReason;
}

export interface ConfirmPrompt {
  promptId: string;
  text: string;
  ttlMs: number;
  expiresAtMs: number;
  defaultAction: 'drop';
  options: Array<{ id: string; label: string; bidderId: string; amountCents: Cents }>;
  spokenAnswerAllowed: boolean;
  /** The bidder this question is addressed to; only that bidder answers for themselves. */
  targetBidderId?: string | null;
}

export type Decision =
  | {
      kind: 'accept';
      bidderId: string;
      amountCents: Cents;
      confidence: number;
      evidence: VoiceEvidence;
    }
  | { kind: 'confirm'; prompt: ConfirmPrompt; evidence: VoiceEvidence }
  | { kind: 'drop'; reason: VoiceReason; evidence: VoiceEvidence };

export type PipelineEvent =
  | { type: 'caption'; text: string; final: boolean }
  | { type: 'decision'; decision: Decision }
  | { type: 'confirm_expired'; promptId: string }
  | {
      type: 'status';
      stt: 'ok' | 'degraded' | 'down';
      llm: 'ok' | 'down' | 'off';
      droppedFrames: number;
    };

// ---------------------------------------------------------------------------
// zod schemas. Objects are strict so persisted audit data stays allow-listed.
// ---------------------------------------------------------------------------

const cents = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const reasonSchema = z.enum(VOICE_REASONS);
const bidderRefSchema = z
  .object({ kind: z.enum(['paddle', 'speaker']), value: z.string() })
  .strict();
const candidateSchema = z
  .object({ bidder: bidderRefSchema.nullable(), amountCents: cents.nullable() })
  .strict();

export const parseResultSchema = z
  .object({
    status: z.enum(['bid', 'confirm', 'none']),
    bidder: bidderRefSchema.nullable(),
    amountCents: cents.nullable(),
    reason: reasonSchema,
    candidates: z.array(candidateSchema),
    flags: z.array(z.enum(PARSE_FLAGS)),
    confidence: z.number().min(0).max(1),
    source: z.enum(['rules', 'llm', 'merged']),
    spans: z
      .array(
        z
          .object({
            kind: z.enum(['amount', 'paddle']),
            start: z.number().int().nonnegative(),
            end: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict()
  .refine((r) => r.status !== 'bid' || r.amountCents !== null, {
    message: 'a bid needs an amount',
  })
  .refine((r) => r.status !== 'bid' || r.bidder !== null, {
    message: 'a bid needs a bidder',
  })
  .refine((r) => (r.spans ?? []).every((s) => s.end >= s.start), {
    message: 'a span must end at or after its start',
  });

export const voiceEvidenceSchema = z
  .object({
    segmentId: z.string().min(1),
    idempotencyKey: z.string().min(1),
    transcript: z.string(),
    audioStartMs: z.number().int().nonnegative(),
    audioEndMs: z.number().int().nonnegative(),
    sttProvider: z.string().min(1),
    sttConfidence: z.number().min(0).max(1),
    replay: z.boolean(),
    rules: parseResultSchema,
    llm: parseResultSchema.nullable(),
    confidence: z.number().min(0).max(1),
    reason: reasonSchema,
  })
  .strict();

/**
 * One audit record per decision, drops included (R-VOX-071): transcript, bidder,
 * amount, confidence, confirmed, accepted/rejected and reason, plus the full evidence.
 */
export const auditRecordSchema = z
  .object({
    decision: z.enum(['accept', 'confirm', 'drop']),
    outcome: z.enum(['accepted', 'pending_confirm', 'rejected']),
    transcript: z.string(),
    bidderId: z.string().nullable(),
    amountCents: cents.nullable(),
    confidence: z.number().min(0).max(1),
    confirmed: z.boolean(),
    reason: reasonSchema,
    evidence: voiceEvidenceSchema,
  })
  .strict();
export type AuditRecord = z.infer<typeof auditRecordSchema>;

/** Build the audit record for any decision. Pure. */
export function toAuditRecord(d: Decision): AuditRecord {
  const ev = d.evidence;
  switch (d.kind) {
    case 'accept':
      return {
        decision: 'accept',
        outcome: 'accepted',
        transcript: ev.transcript,
        bidderId: d.bidderId,
        amountCents: d.amountCents,
        confidence: d.confidence,
        confirmed: false,
        reason: ev.reason,
        evidence: ev,
      };
    case 'confirm': {
      const first = d.prompt.options[0];
      return {
        decision: 'confirm',
        outcome: 'pending_confirm',
        transcript: ev.transcript,
        bidderId: first?.bidderId ?? null,
        amountCents: first?.amountCents ?? null,
        confidence: ev.confidence,
        confirmed: false,
        reason: ev.reason,
        evidence: ev,
      };
    }
    case 'drop': {
      const keep = dropKeepsWords(d);
      return {
        decision: 'drop',
        outcome: 'rejected',
        transcript: keep ? ev.transcript : '',
        bidderId: null,
        amountCents: ev.rules.amountCents,
        confidence: ev.confidence,
        confirmed: false,
        reason: d.reason,
        evidence: keep ? ev : { ...ev, transcript: '' },
      };
    }
  }
}

/**
 * A drop that read no bid (question, filler, bystander chatter) is stored without its words.
 * Drops caused by the system rather than the words (stt unavailable, stale audio) keep them,
 * since they may be a real spoken bid and the transcript is its only evidence.
 */
function dropKeepsWords(d: Extract<Decision, { kind: 'drop' }>): boolean {
  const ev = d.evidence;
  const readAsBid = ev.rules.status !== 'none' || (ev.llm !== null && ev.llm.status !== 'none');
  return (
    readAsBid ||
    d.reason === 'stt_unavailable' ||
    d.reason === 'low_confidence' ||
    d.reason === 'prompt_rate_limited' ||
    d.reason === 'stale_segment'
  );
}
