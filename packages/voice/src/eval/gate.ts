import { VoicePipeline, type PipelineOutput } from '../pipeline/pipeline.js';
import type { SttWord } from '../stt/provider.js';
import type { BidContext, Decision, ParseContext, ParseResult } from '../types.js';
import type { Actual } from './metrics.js';

/**
 * Runs one utterance through the pipeline the room runs (rules parse, section 8 rescoring,
 * validation, AUTO/CONFIRM policy, mic rule) and reports what the room would do with it.
 * Nothing here scores audio; the caller supplies a transcript and, when it was recorded, the
 * speech-to-text confidence.
 */

export type GateMic = 'room' | 'device';
export type GateDecision = 'auto' | 'confirm' | 'drop';

/** Segment confidence that gives the speech-to-text factor 1.0 (section 8); used only when nothing was recorded. */
export const NEUTRAL_STT_CONFIDENCE = 0.85;
/** Context facts text fixtures do not carry; stated in the report, never hidden. */
export const ASSUMED_MIN_INCREMENT_CENTS = 100;
const PADDLES = 99;
const BIG_CEILING_CENTS = 100_000_000;
const END_MS = 1000;

export interface GateInput {
  text: string;
  /** Bidder id (the paddle number in the fixtures) of the speaker, when one is known. */
  speaker: string | null;
  currentPriceCents: number | null;
  minIncrementCents: number | null;
  /** Recorded segment confidence 0..1; absent means none was recorded. */
  sttConfidence?: number;
  /** Recorded word confidences. */
  words?: readonly SttWord[];
  mic: GateMic;
  /** Model reading of the transcript; absent means the model is off and the bid is rules-only. */
  llm?: (text: string, ctx: ParseContext) => ParseResult | null;
}

export interface GateRecord {
  decision: GateDecision;
  /** What the room does, in the same terms as the parser outcome. */
  actual: Actual;
  /** Confidence after rescoring, as the policy saw it. */
  confidence: number;
  reason: string;
  sttSource: 'recorded' | 'neutral_assumed';
}

function context(input: GateInput): BidContext {
  const roster: BidContext['roster'] = new Map();
  for (let p = 1; p <= PADDLES; p++) {
    roster.set(String(p), {
      bidderId: String(p),
      ceilingCents: BIG_CEILING_CENTS,
      holdActive: true,
    });
  }
  return {
    nowMs: END_MS,
    lotState: 'OPEN',
    currentPriceCents: input.currentPriceCents ?? 0,
    minIncrementCents: input.minIncrementCents ?? ASSUMED_MIN_INCREMENT_CENTS,
    highBidderId: null,
    roster,
    recent: [],
  };
}

function toRecord(decision: Decision | undefined, sttSource: GateRecord['sttSource']): GateRecord {
  if (decision === undefined) {
    return {
      decision: 'drop',
      actual: { kind: 'none' },
      confidence: 0,
      reason: 'no_decision',
      sttSource,
    };
  }
  if (decision.kind === 'accept') {
    return {
      decision: 'auto',
      actual: {
        kind: 'accept',
        pair: { who: decision.bidderId, amountCents: decision.amountCents },
      },
      confidence: decision.confidence,
      reason: decision.evidence.reason,
      sttSource,
    };
  }
  if (decision.kind === 'confirm') {
    return {
      decision: 'confirm',
      actual: {
        kind: 'confirm',
        candidates: decision.prompt.options.map((o) => ({
          who: o.bidderId,
          amountCents: o.amountCents,
        })),
      },
      confidence: decision.evidence.confidence,
      reason: decision.evidence.reason,
      sttSource,
    };
  }
  return {
    decision: 'drop',
    actual: { kind: 'none' },
    confidence: decision.evidence.confidence,
    reason: decision.reason,
    sttSource,
  };
}

/** One utterance, one fresh pipeline: no state carries between utterances. */
export function gateUtterance(input: GateInput): GateRecord {
  let now = END_MS;
  let n = 0;
  const pipeline = new VoicePipeline({
    roomId: 'eval',
    lotId: 'eval',
    clock: () => now,
    ids: () => `eval-${++n}`,
    context: () => context(input),
    mic: input.mic,
    ...(input.llm === undefined ? {} : { llm: input.llm }),
    ...(input.speaker === null ? {} : { speakerBidderId: input.speaker }),
  });
  const recorded = input.sttConfidence !== undefined;
  const out: PipelineOutput[] = pipeline.push({
    type: 'final',
    text: input.text,
    words: [...(input.words ?? [])],
    startMs: 0,
    endMs: END_MS,
    confidence: input.sttConfidence ?? NEUTRAL_STT_CONFIDENCE,
    speechFinal: true,
  });
  now += 2000;
  out.push(...pipeline.tick());
  const decision = out.flatMap((o) => (o.type === 'decision' ? [o.decision] : []))[0];
  return toRecord(decision, recorded ? 'recorded' : 'neutral_assumed');
}
