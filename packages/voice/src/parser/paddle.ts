import { PADDLE_VALUE_ASR, PADDLE_WORDS, SCALE, TENS, UNITS, smallValue } from './lexicon.js';
import type { Token } from './normalize.js';

/**
 * Paddle references (R-VOX-040): a paddle word followed by a number in digit or word form,
 * including "bidder number nine" and two-word values ("twenty one"). Resolving a paddle against the
 * roster is done in decide(), not here.
 */

export interface PaddleRef {
  paddle: string;
  /** Token index of the first paddle word and one past the last token of the number. */
  start: number;
  end: number;
  /**
   * Digit read-out reading of "paddle one two ...": the paddle could be 1 or 12. The parser only
   * uses it when the plain reading leaves a number it cannot read.
   */
  alt?: { paddle: string; end: number };
}

export interface PaddleScan {
  /** Paddle numbers in order of appearance, as strings. */
  paddles: string[];
  refs: PaddleRef[];
  /** Indices of the tokens that belong to paddle references. */
  consumed: Set<number>;
}

type TokenLike = string | Token;

const text = (t: TokenLike | undefined): string => (typeof t === 'string' ? t : (t?.text ?? ''));

function paddleValue(w: string): number | undefined {
  const v = smallValue(w);
  if (v !== undefined) return v;
  const fixed = PADDLE_VALUE_ASR[w];
  return fixed === undefined ? undefined : smallValue(fixed);
}

function singleDigit(w: string): number | undefined {
  if (/^[1-9]$/.test(w)) return Number(w);
  const v = UNITS[w];
  return v !== undefined && v > 0 && !/^\d/.test(w) ? v : undefined;
}

function adjacent(a: TokenLike | undefined, b: TokenLike | undefined): boolean {
  if (typeof a === 'string' || typeof b === 'string' || a === undefined || b === undefined)
    return true;
  return b.start - a.end === 1;
}

/** Finds every paddle reference. Pass Token objects to let punctuation block digit read-outs. */
export function extractPaddles(tokens: readonly TokenLike[]): PaddleScan {
  const n = tokens.length;
  const refs: PaddleRef[] = [];
  const consumed = new Set<number>();
  for (let i = 0; i < n; i++) {
    if (!PADDLE_WORDS.has(text(tokens[i]))) continue;
    let j = i + 1;
    while (j < n && PADDLE_WORDS.has(text(tokens[j]))) j += 1;
    if (j >= n) continue;
    const a = text(tokens[j]);
    const next = text(tokens[j + 1]);
    const afterNext = text(tokens[j + 2]);
    let value: number;
    let end: number;
    let alt: PaddleRef['alt'];
    if (/^\d+$/.test(a)) {
      value = Number(a);
      end = j + 1;
    } else if (a in TENS && (UNITS[next] ?? 0) > 0 && !(afterNext in SCALE)) {
      value = (TENS[a] ?? 0) + (UNITS[next] ?? 0);
      end = j + 2;
    } else {
      const v = paddleValue(a);
      if (v === undefined) continue;
      value = v;
      end = j + 1;
    }
    if (end === j + 1) {
      const d1 = singleDigit(a);
      const d2 = singleDigit(next);
      const sameForm = /^\d$/.test(a) === /^\d$/.test(next);
      if (d1 !== undefined && d2 !== undefined && sameForm && adjacent(tokens[j], tokens[j + 1])) {
        alt = { paddle: String(d1 * 10 + d2), end: j + 2 };
      }
    }
    const ref: PaddleRef = { paddle: String(value), start: i, end };
    if (alt !== undefined) ref.alt = alt;
    refs.push(ref);
    for (let k = i; k < end; k++) consumed.add(k);
    i = end - 1;
  }
  return { paddles: refs.map((r) => r.paddle), refs, consumed };
}
