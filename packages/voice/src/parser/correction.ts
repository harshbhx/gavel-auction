import type { BidderRef, Candidate, Cents, ParseContext, ParseResult } from '../types.js';
import { tokenize } from './normalize.js';
import { parseBid } from './parse.js';
import { extractPaddles } from './paddle.js';

/**
 * Corrections, make-it and retraction (R-VOX-043, 044, 050). A correction is never a bid. The
 * pipeline acts on `cancelPending`; nothing here touches an engine or a store.
 */

/** A pending candidate older than this can no longer be corrected or cancelled by voice. */
export const PENDING_MAX_AGE_MS = 8000;
const MAKE_IT_PENALTY = 0.05;

/** Cues that withdraw the previous statement. Without a new amount they are a retraction. */
const RETRACT_CUES: readonly RegExp[] = [
  /\bscratch that\b/g,
  /\bnever ?mind\b/g,
  /\bstrike that\b/g,
  /\bcancel\b/g,
  /\bwithdraw\b/g,
  /\bforget it\b/g,
];

/** Cues that replace the previous statement. */
const REPLACE_CUES: readonly RegExp[] = [
  /\bno wait\b/g,
  /\bwait no\b/g,
  /\bno make it\b/g,
  /\bi mean\b/g,
  /\bsorry\b/g,
  /\bactually\b/g,
  /\bmake that\b/g,
];

const MAKE_IT = /\bmake it\b/g;
const NEGATION_WORD = /\b(no|not|never|don't|dont|won't|wont|can't|cant)\b/;
const NOT_X_Y = /\bnot\s+([^,;.!?]+)[,;]\s*(.+)$/;

export interface CorrectionOutcome {
  result: ParseResult;
  /** True when a pending unconfirmed candidate must be cancelled (retraction, age under 8000 ms). */
  cancelPending: boolean;
  /** The amount being replaced, when known. */
  replacedCents: Cents | null;
}

function lastMatchEnd(norm: string, cues: readonly RegExp[]): number {
  let end = -1;
  for (const re of cues) {
    for (const m of norm.matchAll(re)) end = Math.max(end, (m.index ?? 0) + m[0].length);
  }
  return end;
}

function amountsOf(text: string, ctx: ParseContext): { amounts: Cents[]; res: ParseResult } {
  const res = parseBid(text, { ...ctx, pendingCandidate: undefined });
  const all = [res.amountCents, ...res.candidates.map((c) => c.amountCents)];
  const amounts = [...new Set(all.filter((a): a is number => a !== null))].sort((a, b) => a - b);
  return { amounts, res };
}

/** Both sides known and the same kind and value; an unknown side never matches. */
function sameBidder(a: BidderRef | null, b: BidderRef | null): boolean {
  return a !== null && b !== null && a.kind === b.kind && a.value === b.value;
}

/** The bidder named by the text (a paddle) or by the microphone (the speaker), or null. */
function explicitBidder(text: string, tail: ParseResult, ctx: ParseContext): BidderRef | null {
  if (tail.bidder?.kind === 'paddle') return tail.bidder;
  const paddles = [...new Set(extractPaddles(tokenize(text)).paddles)];
  const only = paddles[0];
  if (paddles.length === 1 && only !== undefined) return { kind: 'paddle', value: only };
  if (ctx.speakerBidderId !== undefined) return { kind: 'speaker', value: ctx.speakerBidderId };
  return null;
}

function bidderFor(text: string, tail: ParseResult, ctx: ParseContext): BidderRef | null {
  return explicitBidder(text, tail, ctx) ?? ctx.pendingCandidate?.bidder ?? null;
}

function correctionResult(
  bidder: BidderRef | null,
  amounts: Cents[],
  flags: ParseResult['flags'],
): ParseResult {
  const candidates: Candidate[] = amounts.map((amountCents) => ({ bidder, amountCents }));
  return {
    status: 'confirm',
    bidder,
    amountCents: amounts.length === 1 ? (amounts[0] ?? null) : null,
    reason: 'correction',
    candidates,
    flags,
    confidence: 0.5,
    source: 'rules',
  };
}

/**
 * Returns null when the text is not a correction, retraction or make-it, so the caller parses it as
 * usual. "make it N" without a pending candidate is a normal bid with a small confidence penalty.
 */
export function parseCorrection(text: string, ctx: ParseContext = {}): CorrectionOutcome | null {
  const norm = tokenize(text)
    .map((t) => t.text)
    .join(' ');
  if (norm === '') return null;
  const pending = ctx.pendingCandidate;
  const live = pending !== undefined && pending.ageMs < PENDING_MAX_AGE_MS ? pending : undefined;

  const retractEnd = lastMatchEnd(norm, RETRACT_CUES);
  const replaceEnd = lastMatchEnd(norm, [
    ...REPLACE_CUES,
    ...(pending !== undefined ? [MAKE_IT] : []),
  ]);
  const cueEnd = Math.max(retractEnd, replaceEnd);

  if (cueEnd >= 0) {
    const tail = norm.slice(cueEnd);
    const { amounts, res } = amountsOf(tail, ctx);
    const bidder = bidderFor(text, res, ctx);
    if (amounts.length > 0) {
      return {
        result: correctionResult(bidder, amounts, ['correction']),
        cancelPending: false,
        replacedCents: pending?.amountCents ?? null,
      };
    }
    if (retractEnd > replaceEnd) {
      const target = bidder ?? pending?.bidder ?? null;
      return {
        result: {
          status: 'none',
          bidder: target,
          amountCents: null,
          reason: 'retract',
          candidates: [],
          flags: ['correction'],
          confidence: 0.5,
          source: 'rules',
        },
        // Only the bidder who is named or speaking can cancel: a room mic with no paddle cannot.
        cancelPending:
          live !== undefined && sameBidder(live.bidder, explicitBidder(text, res, ctx)),
        replacedCents: pending?.amountCents ?? null,
      };
    }
    return {
      result: correctionResult(bidder, [], ['correction']),
      cancelPending: false,
      replacedCents: pending?.amountCents ?? null,
    };
  }

  const lower = text.toLowerCase().replace(/\u2019/g, "'");
  const notXY = NOT_X_Y.exec(lower);
  if (notXY !== null) {
    const x = amountsOf(notXY[1] ?? '', ctx);
    const y = amountsOf(notXY[2] ?? '', ctx);
    if (x.amounts.length > 0 && y.amounts.length > 0) {
      return {
        result: correctionResult(bidderFor(text, y.res, ctx), y.amounts, ['correction']),
        cancelPending: false,
        replacedCents: x.amounts[0] ?? null,
      };
    }
  }

  if (/\bmake it\b/.test(norm) && !NEGATION_WORD.test(norm)) {
    const base = parseBid(text, ctx);
    if (base.status !== 'bid') return { result: base, cancelPending: false, replacedCents: null };
    return {
      result: {
        ...base,
        flags: [...base.flags, 'make_it'],
        confidence: Math.round((base.confidence - MAKE_IT_PENALTY) * 100) / 100,
      },
      cancelPending: false,
      replacedCents: null,
    };
  }
  return null;
}

function usd(cents: Cents): string {
  const dollars = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const rest = cents % 100;
  return rest === 0 ? `$${dollars}` : `$${dollars}.${String(rest).padStart(2, '0')}`;
}

/** Confirm prompt text for a correction; names the replaced amount when it is known. */
export function correctionPrompt(outcome: CorrectionOutcome): string {
  const amounts = outcome.result.candidates
    .map((c) => c.amountCents)
    .filter((a): a is number => a !== null);
  if (amounts.length === 0) return 'Please repeat the amount.';
  const wanted = amounts.map(usd).join(' or ');
  return outcome.replacedCents === null
    ? `Did you mean ${wanted}?`
    : `Replace ${usd(outcome.replacedCents)} with ${wanted}?`;
}
