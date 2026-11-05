import { AUTO_CONFIDENCE } from '../pipeline/bid-command.js';
import type {
  BidContext,
  Cents,
  ConfirmPrompt,
  Decision,
  ParseResult,
  VoiceEvidence,
  VoiceReason,
} from '../types.js';
import { score, type MergeOutcome } from './score.js';
import { validate, type Verdict } from './validate.js';
import { formatUsd, promptText, type PromptData } from './wording.js';

export const CONFIRM_TTL_MS = 8000;

/** What the pipeline knows about one finished speech segment. */
export interface DecideSegment {
  segmentId: string;
  idempotencyKey: string;
  transcript: string;
  audioStartMs: number;
  audioEndMs: number;
  sttProvider: string;
  sttConfidence: number;
  replay: boolean;
  /** Word confidences over the amount and paddle spans, when the provider gives them. */
  wordConfidences?: readonly number[];
}

type Option = ConfirmPrompt['options'][number];

function sameParse(a: ParseResult, b: ParseResult): boolean {
  return (
    a.status === b.status &&
    a.amountCents === b.amountCents &&
    a.bidder?.kind === b.bidder?.kind &&
    a.bidder?.value === b.bidder?.value
  );
}

function paddleOf(ctx: BidContext, bidderId: string): string {
  for (const [paddle, entry] of ctx.roster) {
    if (entry.bidderId === bidderId) return paddle;
  }
  return bidderId;
}

function bidderIdOf(
  ctx: BidContext,
  ref: { kind: 'paddle' | 'speaker'; value: string },
): string | null {
  if (ref.kind === 'paddle') return ctx.roster.get(ref.value)?.bidderId ?? null;
  return ref.value;
}

function optionsFor(rules: ParseResult, verdict: Verdict, ctx: BidContext): Option[] {
  if (verdict.kind !== 'confirm') return [];
  const out: Option[] = [];
  const push = (bidderId: string, amountCents: Cents): void => {
    if (out.some((o) => o.bidderId === bidderId && o.amountCents === amountCents)) return;
    out.push({
      id: `o${out.length + 1}`,
      label: promptLabel(ctx, bidderId, amountCents),
      bidderId,
      amountCents,
    });
  };
  if (verdict.choices !== undefined && verdict.choices.length > 0) {
    for (const c of verdict.choices) push(c.bidderId, c.amountCents);
    return out;
  }
  if (verdict.bidderId !== null) {
    if (verdict.candidates !== undefined) {
      for (const c of verdict.candidates) push(verdict.bidderId, c);
    } else if (verdict.amountCents !== null) {
      push(verdict.bidderId, verdict.amountCents);
    }
    return out;
  }
  // Crosstalk: several bidders in one segment. Each resolvable pair becomes an option.
  for (const c of rules.candidates) {
    if (c.bidder === null || c.amountCents === null) continue;
    const id = bidderIdOf(ctx, c.bidder);
    if (id !== null) push(id, c.amountCents);
  }
  return out;
}

function promptLabel(ctx: BidContext, bidderId: string, amountCents: Cents): string {
  return `Paddle ${paddleOf(ctx, bidderId)} ${formatUsd(amountCents)}`;
}

function promptData(
  reason: VoiceReason,
  options: readonly Option[],
  verdict: Verdict,
  ctx: BidContext,
): PromptData {
  const [a, b] = options;
  if (a !== undefined && b !== undefined) {
    if (a.bidderId !== b.bidderId) {
      return {
        kind: 'two_bidders',
        paddleA: paddleOf(ctx, a.bidderId),
        amountACents: a.amountCents,
        paddleB: paddleOf(ctx, b.bidderId),
        amountBCents: b.amountCents,
      };
    }
    return {
      kind: 'two_amounts',
      amountACents: a.amountCents,
      amountBCents: b.amountCents,
      paddle: paddleOf(ctx, a.bidderId),
    };
  }
  if (a !== undefined) {
    if (reason === 'large_jump' && ctx.currentPriceCents > 0) {
      const times = Math.round((a.amountCents / ctx.currentPriceCents) * 10) / 10;
      return { kind: 'large_jump', times, amountCents: a.amountCents };
    }
    return { kind: 'single', amountCents: a.amountCents, paddle: paddleOf(ctx, a.bidderId) };
  }
  if (verdict.kind === 'confirm' && verdict.amountCents !== null) {
    return { kind: 'unknown_bidder', amountCents: verdict.amountCents };
  }
  return { kind: 'low_confidence' };
}

function buildPrompt(
  seg: DecideSegment,
  reason: VoiceReason,
  options: Option[],
  verdict: Verdict,
  ctx: BidContext,
): ConfirmPrompt {
  const data = promptData(reason, options, verdict, ctx);
  return {
    promptId: `prompt-${seg.idempotencyKey}`,
    text: promptText(data),
    ttlMs: CONFIRM_TTL_MS,
    expiresAtMs: ctx.nowMs + CONFIRM_TTL_MS,
    defaultAction: 'drop',
    options,
    spokenAnswerAllowed: false,
  };
}

/**
 * Composes merge, score and validate into one decision (R-VOX-071). Every outcome, drops
 * included, carries the full evidence record. Only a clean bid that both parsers agree on can
 * be accepted; everything else is a confirm or a drop.
 */
export function decide(
  seg: DecideSegment,
  rules: ParseResult,
  llm: ParseResult | null,
  ctx: BidContext,
): Decision {
  const disagree = llm !== null && !sameParse(rules, llm);
  let merge: MergeOutcome = 'agree';
  if (llm === null) merge = 'model_unavailable';
  else if (rules.flags.length === 0) merge = 'agree_clean';

  const confidence = score({
    flags: rules.flags,
    wordConfidences: seg.wordConfidences ?? [],
    segmentConfidence: seg.sttConfidence,
    merge,
  });

  const evidence = (reason: VoiceReason): VoiceEvidence => ({
    segmentId: seg.segmentId,
    idempotencyKey: seg.idempotencyKey,
    transcript: seg.transcript,
    audioStartMs: seg.audioStartMs,
    audioEndMs: seg.audioEndMs,
    sttProvider: seg.sttProvider,
    sttConfidence: seg.sttConfidence,
    replay: seg.replay,
    rules,
    llm,
    confidence,
    reason,
  });

  if (disagree) return { kind: 'drop', reason: 'llm_disagree', evidence: evidence('llm_disagree') };

  const verdict = validate(rules, ctx);
  if (verdict.kind === 'drop') {
    return { kind: 'drop', reason: verdict.reason, evidence: evidence(verdict.reason) };
  }
  if (verdict.kind === 'accept') {
    if (confidence >= AUTO_CONFIDENCE) {
      return {
        kind: 'accept',
        bidderId: verdict.bidderId,
        amountCents: verdict.amountCents,
        confidence,
        evidence: evidence('ok'),
      };
    }
    const lowVerdict: Verdict = {
      kind: 'confirm',
      reason: 'low_confidence',
      bidderId: verdict.bidderId,
      amountCents: verdict.amountCents,
    };
    const options = optionsFor(rules, lowVerdict, ctx);
    return {
      kind: 'confirm',
      prompt: buildPrompt(seg, 'low_confidence', options, lowVerdict, ctx),
      evidence: evidence('low_confidence'),
    };
  }
  const options = optionsFor(rules, verdict, ctx);
  return {
    kind: 'confirm',
    prompt: buildPrompt(seg, verdict.reason, options, verdict, ctx),
    evidence: evidence(verdict.reason),
  };
}
