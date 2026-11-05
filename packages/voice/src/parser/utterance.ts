import type { ParseContext, ParseResult } from '../types.js';
import { refineAmounts, refineCandidates } from './ambiguity.js';
import { parseWithAsr } from './asr.js';
import { parseCorrection } from './correction.js';
import { detectIntent } from './intent.js';
import type { Intent } from './intent.js';
import { MAX_INPUT_CHARS } from './normalize.js';
import { parseBid } from './parse.js';
import { withSpans } from './spans.js';

/**
 * The single entry point of the rule parser (R-VOX-043, 045, 046, 047, 048, 051, 102). Stages run in
 * this order: length check, intent (withdrawals, hedges, questions, background talk), correction,
 * negation, ASR repair with the bid parser, amount checks, character spans. Pure and deterministic.
 */

const HARD_INTENTS: ReadonlySet<Intent['kind']> = new Set([
  'withdraw',
  'hedged',
  'question',
  'background',
]);

function fromIntent(intent: Intent, base: ParseResult): ParseResult {
  const status = intent.status ?? 'none';
  const keepsAmount = status === 'confirm' && base.amountCents !== null;
  return {
    status,
    bidder: keepsAmount ? base.bidder : null,
    amountCents: null,
    reason: intent.reason ?? 'garbage',
    candidates: keepsAmount ? [{ bidder: base.bidder, amountCents: base.amountCents }] : [],
    flags: [],
    confidence: 0.5,
    source: 'rules',
  };
}

/** A parse result plus the pipeline signal for a retraction (R-VOX-044, 050). */
export interface UtteranceOutcome {
  result: ParseResult;
  /** True when the utterance retracts the fresh pending candidate, so the pipeline must clear it. */
  cancelPending: boolean;
}

/**
 * Parses one final transcript and also reports whether it cancels the pending candidate. A caller
 * that keeps a PendingCandidateStore clears it when cancelPending is true.
 */
export function parseUtteranceOutcome(text: string, ctx: ParseContext = {}): UtteranceOutcome {
  if (text.length > MAX_INPUT_CHARS) {
    return { result: withSpans(text, parseBid(text, ctx)), cancelPending: false };
  }
  const intent = detectIntent(text);
  if (HARD_INTENTS.has(intent.kind)) {
    return {
      result: withSpans(text, refineCandidates(text, fromIntent(intent, parseBid(text, ctx)))),
      cancelPending: false,
    };
  }
  const correction = parseCorrection(text, ctx);
  if (correction !== null) {
    const r = correction.result;
    return {
      result: withSpans(
        text,
        r.status === 'bid' ? refineAmounts(text, ctx, r) : refineCandidates(text, r),
      ),
      cancelPending: correction.cancelPending,
    };
  }
  if (intent.status !== null) {
    return {
      result: withSpans(text, fromIntent(intent, parseBid(text, ctx))),
      cancelPending: false,
    };
  }
  return {
    result: withSpans(text, refineAmounts(text, ctx, parseWithAsr(text, ctx))),
    cancelPending: false,
  };
}

/** Parses one final transcript through every rule stage and returns the checked result with spans. */
export function parseUtterance(text: string, ctx: ParseContext = {}): ParseResult {
  return parseUtteranceOutcome(text, ctx).result;
}
