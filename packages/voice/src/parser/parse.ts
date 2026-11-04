import type { Candidate, ParseContext, ParseFlag, ParseResult, VoiceReason } from '../types.js';
import { CENT_WORDS, NON_USD_WORDS, SCALE, USD_WORDS } from './lexicon.js';
import { MAX_INPUT_CHARS, findNumberSpans, tokenize } from './normalize.js';
import { spanValue } from './numbers.js';

/**
 * Amount part of the bid parser (R-VOX-035, 038, 039). Paddles, corrections, hedges, questions and
 * ASR repair are added by later issues; until then the bidder is always ctx.speakerBidderId.
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

interface Amount {
  cents: number;
  colloquial: boolean;
}

function parseAmounts(tokens: string[]): {
  amounts: Amount[];
  unreadable: number;
  centsOnly: number[];
} {
  const spans = findNumberSpans(tokens);
  const amounts: Amount[] = [];
  const centsOnly: number[] = [];
  let unreadable = 0;
  for (let k = 0; k < spans.length; k++) {
    const [s, e] = spans[k] ?? [0, 0];
    const slice = tokens.slice(s, e);
    const value = spanValue(slice);
    const after = tokens[e] ?? '';
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
    amounts.push({ cents: value, colloquial: isColloquialHundreds(slice, value) });
  }
  return { amounts, unreadable, centsOnly };
}

export function parseBid(text: string, ctx: ParseContext = {}): ParseResult {
  try {
    return parse(text, ctx);
  } catch {
    return result('none', 'garbage');
  }
}

function parse(text: string, ctx: ParseContext): ParseResult {
  if (text.length > MAX_INPUT_CHARS) return result('none', 'too_long');
  const tokens = tokenize(text).map((t) => t.text);
  if (tokens.length === 0) return result('none', 'empty');

  const bidder =
    ctx.speakerBidderId === undefined
      ? null
      : { kind: 'speaker' as const, value: ctx.speakerBidderId };
  const { amounts, unreadable, centsOnly } = parseAmounts(tokens);
  const cand = (amountCents: number): Candidate => ({ bidder, amountCents });

  if (amounts.length === 0 && centsOnly.length === 0 && unreadable === 0)
    return result('none', 'no_amount');

  if (tokens.some((t) => NON_USD_WORDS.has(t))) {
    return result('confirm', 'unsupported_currency', { bidder });
  }
  if (amounts.length === 0 && centsOnly.length > 0) {
    const sorted = [...new Set(centsOnly)].sort((a, b) => a - b);
    return result('confirm', 'fractional_amount', {
      bidder,
      amountCents: sorted[0] ?? null,
      candidates: sorted.map(cand),
    });
  }
  if (amounts.length === 0) return result('confirm', 'uninterpretable_number', { bidder });

  const distinct = [...new Set(amounts.map((a) => a.cents))].sort((a, b) => a - b);
  if (distinct.length > 1) {
    return result('confirm', 'multiple_amounts', { bidder, candidates: distinct.map(cand) });
  }
  const only = amounts[0];
  const amountCents = distinct[0];
  if (only === undefined || amountCents === undefined) return result('none', 'no_amount');
  if (amountCents % 100 !== 0) {
    return result('confirm', 'fractional_amount', {
      bidder,
      amountCents,
      candidates: [cand(amountCents)],
    });
  }
  const flags: ParseFlag[] = amounts.some((a) => a.colloquial) ? ['colloquial_hundreds'] : [];
  if (bidder === null) {
    return result('confirm', 'unknown_bidder', {
      amountCents,
      candidates: [cand(amountCents)],
      flags,
    });
  }
  return result('bid', 'ok', { bidder, amountCents, flags });
}
