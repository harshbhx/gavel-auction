import type { ParseResult } from '../types.js';
import { MAX_INPUT_CHARS, findNumberSpans, tokenize } from './normalize.js';
import { extractPaddles } from './paddle.js';

/**
 * Character spans for the amount and paddle tokens (R-VOX-053). Offsets index into the original
 * text, so the console can highlight them even after lower-casing and punctuation removal.
 */

export type ParseSpan = NonNullable<ParseResult['spans']>[number];

const CURRENCY_SYMBOL = /^[$£€₹¥]$/;

export function computeSpans(text: string): ParseSpan[] {
  if (text.length > MAX_INPUT_CHARS) return [];
  const toks = tokenize(text);
  const scan = extractPaddles(toks);
  const spans: ParseSpan[] = [];
  for (const ref of scan.refs) {
    const first = toks[ref.start];
    const last = toks[ref.end - 1];
    if (first !== undefined && last !== undefined) {
      spans.push({ kind: 'paddle', start: first.start, end: last.end });
    }
  }
  const restIndex: number[] = [];
  toks.forEach((_, i) => {
    if (!scan.consumed.has(i)) restIndex.push(i);
  });
  const restText = restIndex.map((i) => toks[i]?.text ?? '');
  for (const [s, e] of findNumberSpans(restText)) {
    // A run that jumps over a paddle reference is highlighted as separate pieces.
    let from = s;
    for (let k = s; k < e; k++) {
      const contiguous = k + 1 < e && (restIndex[k + 1] ?? -1) === (restIndex[k] ?? -2) + 1;
      if (k + 1 < e && contiguous) continue;
      const firstIdx = restIndex[from] ?? 0;
      const lastIdx = restIndex[k] ?? 0;
      const first = toks[firstIdx];
      const last = toks[lastIdx];
      if (first !== undefined && last !== undefined) {
        const symbol = toks[firstIdx - 1];
        const start =
          symbol !== undefined && CURRENCY_SYMBOL.test(symbol.text) && symbol.end === first.start
            ? symbol.start
            : first.start;
        spans.push({ kind: 'amount', start, end: last.end });
      }
      from = k + 1;
    }
  }
  return spans.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** The result with spans filled in; the original object is not modified. */
export function withSpans(text: string, result: ParseResult): ParseResult {
  return { ...result, spans: computeSpans(text) };
}
