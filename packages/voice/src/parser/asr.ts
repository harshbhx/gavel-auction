import type { Candidate, ParseContext, ParseResult } from '../types.js';
import { PADDLE_WORDS, isNumberToken } from './lexicon.js';
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

/** Repairs ASR confusions in lower-case tokens. Pure. */
export function repairTokens(tokens: readonly string[]): AsrRepair {
  const fixed: string[] = [];
  const dropped = new Set<number>();
  tokens.forEach((t, i) => {
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
      if ((afterNumber && !beforeNumber) || PADDLE_WORDS.has(next)) {
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
