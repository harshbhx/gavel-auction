import type { Candidate, Cents, ParseContext, ParseResult } from '../types.js';
import { findNumberSpans, tokenize } from './normalize.js';
import { spanValue } from './numbers.js';
import { extractPaddles } from './paddle.js';
import { parseBid } from './parse.js';
import { withSpans } from './spans.js';

/**
 * Amount sanity and homophone checks on top of the parser core (R-VOX-048, 049, 051). Multiple
 * amounts, multiple paddles, uninterpretable spans and "no amount" come from parseBid itself.
 */

/** Amounts below this many cents are not a bid (R-VOX-051). */
export const MIN_PLAUSIBLE_CENTS = 100;
/** Amounts above this many cents (1,000,000 dollars) are not a bid (R-VOX-051). */
export const MAX_PLAUSIBLE_CENTS = 100_000_000;

/** "fifty" and "fifteen" sound alike; each teen/ty word maps to the other one (R-VOX-048). */
export const HOMOPHONES: ReadonlyMap<string, string> = new Map([
  ['fifty', 'fifteen'],
  ['fifteen', 'fifty'],
  ['sixty', 'sixteen'],
  ['sixteen', 'sixty'],
  ['seventy', 'seventeen'],
  ['seventeen', 'seventy'],
  ['eighty', 'eighteen'],
  ['eighteen', 'eighty'],
  ['ninety', 'nineteen'],
  ['nineteen', 'ninety'],
  ['thirty', 'thirteen'],
  ['thirteen', 'thirty'],
  ['forty', 'fourteen'],
  ['fourteen', 'forty'],
]);

const HUGE_WORDS = new Set([
  'million',
  'millions',
  'mil',
  'mill',
  'billion',
  'billions',
  'bil',
  'trillion',
  'trillions',
  'crore',
  'crores',
]);

function implausible(base: ParseResult, amountCents: Cents | null): ParseResult {
  const candidates: Candidate[] =
    amountCents === null ? [] : [{ bidder: base.bidder, amountCents }];
  return {
    ...base,
    status: 'confirm',
    reason: 'implausible_amount',
    amountCents,
    candidates,
  };
}

/** Plausibility of every candidate of a correction or hedge result; never lets one through as is. */
export function refineCandidates(text: string, base: ParseResult): ParseResult {
  if (base.status !== 'confirm' || base.candidates.length === 0) return base;
  const words = tokenize(text).map((t) => t.text);
  const bad = base.candidates.some(
    (c) =>
      c.amountCents !== null &&
      (c.amountCents < MIN_PLAUSIBLE_CENTS || c.amountCents > MAX_PLAUSIBLE_CENTS),
  );
  if (!bad && !words.some((w) => HUGE_WORDS.has(w))) return base;
  return implausible(base, base.amountCents);
}

/** Number spans of the text outside paddle references, as token lists. */
function amountSpans(text: string): string[][] {
  const toks = tokenize(text);
  const consumed = extractPaddles(toks).consumed;
  const rest = toks.filter((_, i) => !consumed.has(i)).map((t) => t.text);
  return findNumberSpans(rest).map(([s, e]) => rest.slice(s, e));
}

function homophoneAlternatives(text: string, priceCents: Cents): Cents[] {
  const alts: Cents[] = [];
  for (const span of amountSpans(text)) {
    span.forEach((word, k) => {
      const other = HOMOPHONES.get(word);
      if (other === undefined) return;
      const swapped = [...span.slice(0, k), other, ...span.slice(k + 1)];
      const value = spanValue(swapped);
      if (value !== null && value > priceCents) alts.push(value);
    });
  }
  return alts;
}

/** Applies R-VOX-048 and R-VOX-051 to the parser's answer. Pure. */
export function refineAmounts(text: string, ctx: ParseContext, base: ParseResult): ParseResult {
  const words = tokenize(text).map((t) => t.text);
  if (base.status === 'none' && base.reason === 'no_amount') {
    const spans = amountSpans(text).filter((s) => !s.every((w) => w === 'oh'));
    const values = spans.map((s) => spanValue(s));
    if (values.length > 0 && values.every((v) => v === 0)) return implausible(base, 0);
    return base;
  }
  const decidable =
    base.amountCents !== null &&
    (base.status === 'bid' ||
      base.reason === 'fractional_amount' ||
      base.reason === 'unknown_bidder');
  if (!decidable || base.amountCents === null) return base;
  const amount = base.amountCents;
  if (
    amount < MIN_PLAUSIBLE_CENTS ||
    amount > MAX_PLAUSIBLE_CENTS ||
    words.some((w) => HUGE_WORDS.has(w))
  ) {
    return implausible(base, amount);
  }
  const price = ctx.currentPriceCents;
  if (price !== undefined && amount <= price) {
    const alts = homophoneAlternatives(text, price);
    if (alts.length > 0) {
      const amounts = [...new Set([amount, ...alts])].sort((a, b) => a - b);
      return {
        ...base,
        status: 'confirm',
        reason: 'homophone',
        candidates: amounts.map((amountCents) => ({ bidder: base.bidder, amountCents })),
        confidence: 0.5,
      };
    }
  }
  return base;
}

/** parseBid plus amount checks plus character spans into the original text. */
export function parseBidChecked(text: string, ctx: ParseContext = {}): ParseResult {
  return withSpans(text, refineAmounts(text, ctx, parseBid(text, ctx)));
}
