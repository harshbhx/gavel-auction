import { SCALE, isNumberToken } from './lexicon.js';

/** A normalised token with its offsets in the original text. */
export interface Token {
  text: string;
  start: number;
  end: number;
}

/** Longest input the parser looks at (R-VOX-035). */
export const MAX_INPUT_CHARS = 2000;

const TOKEN = /[$£€₹¥%]|\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\p{L}+(?:['’]\p{L}+)?/gu;

/**
 * Lower-cases and splits into words, numerals and currency symbols. Thousands commas are removed
 * ("1,500" becomes "1500"), "1.5k" becomes "1.5" and "k", and punctuation and hyphens only separate.
 */
export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const raw = m[0];
    const start = m.index ?? 0;
    out.push({
      text: raw.toLowerCase().replace(/’/g, "'").replace(/,/g, ''),
      start,
      end: start + raw.length,
    });
  }
  return out;
}

/**
 * Maximal runs of number tokens as [start, end) token ranges. Joins "and" between number tokens
 * ("four hundred and fifty"), "and a half" before a scale word, and a leading "a" before a scale
 * word ("a hundred"). A leading "oh" is an interjection, not a zero, when more number tokens follow.
 */
export function findNumberSpans(tokens: readonly string[]): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const n = tokens.length;
  const at = (i: number): string => tokens[i] ?? '';
  let i = 0;
  while (i < n) {
    const t = at(i);
    const articleStart = t === 'a' && i + 1 < n && at(i + 1) in SCALE;
    if (!(articleStart || (isNumberToken(t) && t !== 'point'))) {
      i += 1;
      continue;
    }
    let j = i + 1;
    for (;;) {
      if (j < n && isNumberToken(at(j))) {
        j += 1;
      } else if (
        at(j) === 'and' &&
        j + 1 < n &&
        isNumberToken(at(j + 1)) &&
        at(j + 1) !== 'point'
      ) {
        j += 1;
      } else if (
        at(j) === 'and' &&
        at(j + 1) === 'a' &&
        at(j + 2) === 'half' &&
        at(j + 3) in SCALE
      ) {
        j += 4;
      } else {
        break;
      }
    }
    spans.push([t === 'oh' && j - i > 1 ? i + 1 : i, j]);
    i = j;
  }
  return spans;
}
