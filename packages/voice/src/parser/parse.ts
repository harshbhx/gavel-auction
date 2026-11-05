import type {
  BidderRef,
  Candidate,
  ParseContext,
  ParseFlag,
  ParseResult,
  VoiceReason,
} from '../types.js';
import { CENT_WORDS, NON_USD_WORDS, SCALE, USD_WORDS } from './lexicon.js';
import { MAX_INPUT_CHARS, findNumberSpans, tokenize } from './normalize.js';
import { spanValue } from './numbers.js';
import { extractPaddles } from './paddle.js';

/**
 * Bid parser core (R-VOX-035, 038, 039, 040, 041): amounts, currency and paddles. Corrections, hedges,
 * questions and ASR repair are added by later issues.
 * Pure, deterministic and total: it never throws.
 */

// Placeholder confidences until the scorer (section 8) is wired in.
const CONF_BID = 1;
const CONF_OTHER = 0.5;

function result(
  status: ParseResult['status'],
  reason: VoiceReason,
  extra: Partial<ParseResult> = {},
): ParseResult {
  return {
    status,
    bidder: null,
    amountCents: null,
    reason,
    candidates: [],
    flags: [],
    confidence: status === 'bid' ? CONF_BID : CONF_OTHER,
    source: 'rules',
    ...extra,
  };
}

function isColloquialHundreds(words: string[], cents: number): boolean {
  if (words.length < 2 || cents < 10000) return false;
  return !words.some((w) => w in SCALE || w === 'point' || /\d/.test(w));
}

/** A word right after a number that makes it a measure, not a bid ("a hundred percent", "5M"). */
const UNIT_WORDS: ReadonlySet<string> = new Set([
  '%',
  'percent',
  'pct',
  'm',
  'mm',
  'bn',
  'mile',
  'miles',
  'km',
  'kg',
  'kilos',
  'meters',
  'feet',
  'inches',
  'years',
  'hours',
  'minutes',
  'seconds',
  'days',
]);

interface Amount {
  cents: number;
  colloquial: boolean;
}

function parseAmounts(tokens: string[]): {
  amounts: Amount[];
  unreadable: number;
  centsOnly: number[];
  unit: boolean;
} {
  let unit = false;
  const spans = findNumberSpans(tokens);
  const amounts: Amount[] = [];
  const centsOnly: number[] = [];
  let unreadable = 0;
  for (let k = 0; k < spans.length; k++) {
    const [s, e] = spans[k] ?? [0, 0];
    const slice = tokens.slice(s, e);
    const value = spanValue(slice);
    const after = tokens[e] ?? '';
    if (UNIT_WORDS.has(after)) unit = true;
    if (CENT_WORDS.has(after)) {
      // "fifty cents" on its own is a fractional amount, never a whole-dollar bid.
      if (value !== null && value > 0) centsOnly.push(Math.round(value / 100));
      else unreadable += 1;
      continue;
    }
    if (value === null) {
      unreadable += 1;
      continue;
    }
    if (value === 0) continue;
    // "N dollars M cents": N*100 + M.
    const next = spans[k + 1];
    if (
      USD_WORDS.has(after) &&
      next !== undefined &&
      next[0] === e + 1 &&
      CENT_WORDS.has(tokens[next[1]] ?? '')
    ) {
      const m = spanValue(tokens.slice(next[0], next[1]));
      if (m !== null && m % 100 === 0 && m / 100 < 100) {
        amounts.push({ cents: value + m / 100, colloquial: false });
        k += 1;
        continue;
      }
    }
    // "five and a half": the half is part of the amount, so the bid is fractional, not whole.
    const half = tokens[e] === 'and' && tokens[e + 1] === 'a' && tokens[e + 2] === 'half';
    amounts.push({
      cents: half ? value + 50 : value,
      colloquial: !half && isColloquialHundreds(slice, value),
    });
  }
  return { amounts, unreadable, centsOnly, unit };
}

export function parseBid(text: string, ctx: ParseContext = {}): ParseResult {
  try {
    return parse(text, ctx);
  } catch {
    return result('none', 'garbage');
  }
}

function paddleOrder(a: string, b: string): number {
  return Number(a) - Number(b) || a.localeCompare(b);
}

function parse(text: string, ctx: ParseContext): ParseResult {
  if (text.length > MAX_INPUT_CHARS) return result('none', 'too_long');
  const toks = tokenize(text);
  const tokens = toks.map((t) => t.text);
  if (tokens.length === 0) return result('none', 'empty');

  const speaker: BidderRef | null =
    ctx.speakerBidderId === undefined ? null : { kind: 'speaker', value: ctx.speakerBidderId };
  const scan = extractPaddles(toks);
  const rest = (skip: Set<number>): string[] => tokens.filter((_, i) => !skip.has(i));
  const { amounts, unreadable, centsOnly, unit } = parseAmounts(rest(scan.consumed));
  const cand = (amountCents: number | null, bidder: BidderRef | null): Candidate => ({
    bidder,
    amountCents,
  });
  const paddle = (p: string): BidderRef => ({ kind: 'paddle', value: p });

  if (amounts.length === 0 && centsOnly.length === 0 && unreadable === 0)
    return result('none', 'no_amount');

  // "paddle five hundred": the number is either the paddle (and the amount is a bare "hundred") or
  // the start of the amount. Both readings go to the console; neither is accepted by itself.
  const scaled = scan.refs.find((r) => r.scaleAfter === true);
  if (scaled !== undefined) {
    const skip = new Set<number>();
    for (let k = scaled.start; k < scaled.valueStart; k++) skip.add(k);
    const asAmount = parseAmounts(rest(skip)).amounts[0]?.cents ?? null;
    const asPaddle = amounts[0]?.cents ?? null;
    const candidates = [cand(asPaddle, paddle(scaled.paddle)), cand(asAmount, speaker)].sort(
      (a, b) => (a.amountCents ?? 0) - (b.amountCents ?? 0),
    );
    return result('confirm', 'multiple_bidders', { candidates });
  }

  const distinctPaddles = [...new Set(scan.paddles)].sort(paddleOrder);
  const distinctAmounts = [...new Set(amounts.map((a) => a.cents))].sort((a, b) => a - b);
  const sharedAmount = distinctAmounts.length === 1 ? (distinctAmounts[0] ?? null) : null;

  if (distinctPaddles.length > 1) {
    return result('confirm', 'multiple_bidders', {
      candidates: distinctPaddles.map((p) => cand(sharedAmount, paddle(p))),
    });
  }
  const only = scan.refs[0];
  const bidder: BidderRef | null = only === undefined ? speaker : paddle(only.paddle);

  // "paddle one two three hundred": the plain reading leaves an unreadable number, the digit
  // read-out reading ("paddle twelve, three hundred") does not. Ask which one was meant.
  if (only?.alt !== undefined && amounts.length === 0 && unreadable > 0) {
    const skip = new Set<number>();
    for (let k = only.start; k < only.alt.end; k++) skip.add(k);
    const alt = parseAmounts(rest(skip));
    const altAmounts = [...new Set(alt.amounts.map((a) => a.cents))];
    if (altAmounts.length === 1) {
      return result('confirm', 'multiple_bidders', {
        candidates: [
          cand(null, paddle(only.paddle)),
          cand(altAmounts[0] ?? null, paddle(only.alt.paddle)),
        ],
      });
    }
  }

  if (tokens.some((t) => NON_USD_WORDS.has(t))) {
    return result('confirm', 'unsupported_currency', { bidder });
  }
  if (unit) return result('confirm', 'uninterpretable_number', { bidder });
  if (amounts.length === 0 && centsOnly.length > 0) {
    const sorted = [...new Set(centsOnly)].sort((a, b) => a - b);
    return result('confirm', 'fractional_amount', {
      bidder,
      amountCents: sorted[0] ?? null,
      candidates: sorted.map((c) => cand(c, bidder)),
    });
  }
  if (amounts.length === 0) return result('confirm', 'uninterpretable_number', { bidder });

  if (distinctAmounts.length > 1) {
    return result('confirm', 'multiple_amounts', {
      bidder,
      candidates: distinctAmounts.map((c) => cand(c, bidder)),
    });
  }
  const amountCents = distinctAmounts[0];
  if (amountCents === undefined) return result('none', 'no_amount');
  if (amountCents % 100 !== 0) {
    return result('confirm', 'fractional_amount', {
      bidder,
      amountCents,
      candidates: [cand(amountCents, bidder)],
    });
  }
  const flags: ParseFlag[] = amounts.some((a) => a.colloquial) ? ['colloquial_hundreds'] : [];
  if (bidder === null) {
    return result('confirm', 'unknown_bidder', {
      amountCents,
      candidates: [cand(amountCents, null)],
      flags,
    });
  }
  // The speaker is a bidder id and the spoken label a paddle: compare through the speaker's
  // paddle. Without it, only a context whose bidder ids are paddle labels can match.
  if (
    only !== undefined &&
    speaker !== null &&
    (ctx.speakerPaddle ?? speaker.value) !== only.paddle
  ) {
    return result('confirm', 'multiple_bidders', {
      amountCents,
      candidates: [cand(amountCents, speaker), cand(amountCents, paddle(only.paddle))],
      flags,
    });
  }
  return result('bid', 'ok', { bidder, amountCents, flags });
}
