import type { Candidate, ParseContext, ParseResult } from '../types.js';
import { PADDLE_WORDS, SCALE, isNumberToken } from './lexicon.js';
import { tokenize } from './normalize.js';
import { parseBid } from './parse.js';

/**
 * ASR repair (R-VOX-042). Confusions are repaired only next to number words or paddle words, and
 * "to", "too" and "for" after a raising verb are checked both ways. Ported from
 * reference/python/parser.py.
 */

const ASR = new Map<string, string>([
  ['to', 'two'],
  ['too', 'two'],
  ['tu', 'two'],
  ['for', 'four'],
  ['fore', 'four'],
  ['free', 'three'],
  ['tree', 'three'],
  ['ate', 'eight'],
  ['won', 'one'],
  ['fifthy', 'fifty'],
  ['sirty', 'thirty'],
  ['fiddy', 'fifty'],
  ['hunderd', 'hundred'],
  ['hundread', 'hundred'],
  ['hunnerd', 'hundred'],
  ['tousand', 'thousand'],
  ['thousend', 'thousand'],
]);

/** Misspellings that are never ordinary words, repaired wherever they appear. */
const ALWAYS = new Set([
  'hunderd',
  'hundread',
  'hunnerd',
  'tousand',
  'thousend',
  'fifthy',
  'sirty',
  'fiddy',
]);

const PREPOSITIONS = new Set(['to', 'too', 'for']);

/** Words speech-to-text writes for "paddle" ("panel twelve", "pedal seven"). */
const PADDLE_HOMOPHONES = new Set(['panel', 'pedal', 'peddle', 'paddel', 'paddles']);

/** A number that can follow a paddle word: a digit run or a number word. */
function startsPaddleNumber(token: string): boolean {
  if (token === 'point' || token in SCALE) return false;
  return isNumberToken(token);
}

/** Raising verbs after which "to" or "for" may be a preposition rather than a digit. */
export const PREP_VERBS: ReadonlySet<string> = new Set([
  'raise',
  'up',
  'go',
  'goes',
  'bump',
  'make',
  'increase',
  'it',
  'bid',
  'say',
]);

export interface AsrRepair {
  tokens: string[];
  /** True when a "to"/"too"/"for" after a raising verb was repaired and could be a preposition. */
  ambiguous: boolean;
  /** The preposition reading (those tokens removed), or null when not ambiguous. */
  alt: string[] | null;
}

function nextToNumber(token: string): boolean {
  if (token === '') return false;
  if (PADDLE_WORDS.has(token)) return true;
  return /^\p{L}+$/u.test(token) && isNumberToken(ASR.get(token) ?? token);
}

/** True when the tokens just before index i end a paddle reference ("paddle seven", "bidder twenty one"). */
function endsPaddleRef(tokens: readonly string[], i: number): boolean {
  let k = i - 1;
  while (k >= 0 && isNumberToken(tokens[k] ?? '')) k -= 1;
  return k < i - 1 && PADDLE_WORDS.has(tokens[k] ?? '');
}

/** Repairs ASR confusions in lower-case tokens. Pure. */
export function repairTokens(tokens: readonly string[]): AsrRepair {
  const fixed: string[] = [];
  const dropped = new Set<number>();
  tokens.forEach((t, i) => {
    // "panel twelve three fifty" is paddle 12, repaired only in front of a number.
    if (PADDLE_HOMOPHONES.has(t) && startsPaddleNumber(tokens[i + 1] ?? '')) {
      fixed.push('paddle');
      return;
    }
    const repl = ASR.get(t);
    if (repl === undefined) {
      fixed.push(t);
      return;
    }
    const prev = tokens[i - 1] ?? '';
    const next = tokens[i + 1] ?? '';
    // A preposition right after a finished amount ("three hundred to me", "five hundred for
    // paddle seven") is not a digit: repairing it would silently append one to the amount.
    if (PREPOSITIONS.has(t) && !ALWAYS.has(t)) {
      const afterNumber = isNumberToken(prev);
      const beforeNumber = /^\p{L}+$/u.test(next) && isNumberToken(ASR.get(next) ?? next);
      if ((afterNumber && !beforeNumber) || PADDLE_WORDS.has(next) || endsPaddleRef(tokens, i)) {
        fixed.push(t);
        return;
      }
    }
    const near = nextToNumber(prev) || nextToNumber(next);
    if (!ALWAYS.has(t) && !near) {
      fixed.push(t);
      return;
    }
    fixed.push(repl);
    if (PREPOSITIONS.has(t) && PREP_VERBS.has(tokens[i - 1] ?? '')) dropped.add(i);
  });
  if (dropped.size === 0) return { tokens: fixed, ambiguous: false, alt: null };
  return {
    tokens: fixed,
    ambiguous: true,
    alt: tokens.filter((_, i) => !dropped.has(i)),
  };
}

const LOT_WORDS = new Set(['lot', 'item', 'page']);

/**
 * "paddle 9400" and "panel 12,350": the provider wrote a spoken paddle and amount ("paddle nine,
 * four hundred") as one digit run. The split is never guessed: each reading goes to the console as
 * a candidate. Returns null when the text is not a paddle word followed by one long digit run.
 */
function splitPaddleDigits(
  tokens: readonly string[],
  flags: ParseResult['flags'],
): ParseResult | null {
  for (let i = 0; i < tokens.length; i++) {
    if (!PADDLE_WORDS.has(tokens[i] ?? '') || LOT_WORDS.has(tokens[i - 1] ?? '')) continue;
    let j = i + 1;
    while (PADDLE_WORDS.has(tokens[j] ?? '')) j += 1;
    const digits = tokens[j] ?? '';
    if (!/^[1-9]\d{2,5}$/.test(digits)) continue;
    const others = tokens.filter((_, k) => k !== j);
    if (others.some((t) => startsPaddleNumber(t))) return null;
    const candidates: Candidate[] = [];
    for (const k of [1, 2]) {
      const rest = digits.slice(k);
      if (rest.length >= 2 && !rest.startsWith('0')) {
        candidates.push({
          bidder: { kind: 'paddle', value: digits.slice(0, k) },
          amountCents: Number(rest) * 100,
        });
      }
    }
    if (candidates.length === 0) return null;
    return {
      status: 'confirm',
      bidder: null,
      amountCents: null,
      reason: 'multiple_bidders',
      candidates: candidates.sort((a, b) => (a.amountCents ?? 0) - (b.amountCents ?? 0)),
      flags,
      confidence: 0.5,
      source: 'rules',
    };
  }
  return null;
}

function amountsOf(r: ParseResult): number[] {
  const all = [r.amountCents, ...r.candidates.map((c) => c.amountCents)];
  return all.filter((a): a is number => a !== null);
}

/**
 * Parses text after ASR repair. When both readings of "to"/"for" differ in outcome the result is
 * confirm with reason to_for_ambiguity and both amounts as candidates.
 */
export function parseWithAsr(text: string, ctx: ParseContext = {}): ParseResult {
  const original = tokenize(text).map((t) => t.text);
  const repair = repairTokens(original);
  const changed = repair.tokens.some((t, i) => t !== original[i]);
  const split = splitPaddleDigits(repair.tokens, changed ? ['asr_repair'] : []);
  if (split !== null) return split;
  const first = parseBid(repair.tokens.join(' '), ctx);
  const withFlag: ParseResult =
    changed && !first.flags.includes('asr_repair')
      ? { ...first, flags: [...first.flags, 'asr_repair'] }
      : first;
  if (!repair.ambiguous || repair.alt === null) return withFlag;
  const second = parseBid(repair.alt.join(' '), ctx);
  const same =
    first.status === second.status &&
    first.amountCents === second.amountCents &&
    first.bidder?.value === second.bidder?.value;
  if (same) return withFlag;
  const bidder = first.bidder ?? second.bidder;
  const amounts = [...new Set([...amountsOf(first), ...amountsOf(second)])].sort((a, b) => a - b);
  const candidates: Candidate[] = amounts.map((amountCents) => ({ bidder, amountCents }));
  return {
    status: 'confirm',
    bidder,
    amountCents: null,
    reason: 'to_for_ambiguity',
    candidates,
    flags: ['asr_repair'],
    confidence: 0.5,
    source: 'rules',
  };
}
