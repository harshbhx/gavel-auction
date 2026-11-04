import { SCALE, isNumberToken } from '../parser/lexicon.js';
import type { SttWord } from '../stt/provider.js';

/** A silence of this long between two words ends a segment (R-VOX-029). */
export const GAP_SPLIT_MS = 700;

function norm(word: string): string {
  return word
    .toLowerCase()
    .replace(/[^\p{L}\p{N}.]/gu, '')
    .replace(/^\.+|\.+$/g, '');
}

function isNum(word: string): boolean {
  return word !== '' && isNumberToken(word);
}

/** True when the gap after words[i] sits inside a number span ("two ... fifty") and must not split. */
function insideNumber(words: readonly SttWord[], i: number): boolean {
  const a = norm(words[i]?.word ?? '');
  const b = norm(words[i + 1]?.word ?? '');
  if (isNum(a) && isNum(b)) return true;
  if (isNum(a) && b === 'and' && isNum(norm(words[i + 2]?.word ?? ''))) return true;
  if (a === 'and' && isNum(b) && isNum(norm(words[i - 1]?.word ?? ''))) return true;
  return a === 'a' && b in SCALE;
}

/**
 * Splits timed words at silences of `gapMs` or more, never inside a number span. Several paddle
 * references stay together in one group so the parser can flag multiple_bidders (R-VOX-030).
 */
export function splitAtGaps(words: readonly SttWord[], gapMs: number = GAP_SPLIT_MS): SttWord[][] {
  const groups: SttWord[][] = [];
  let current: SttWord[] = [];
  words.forEach((word, i) => {
    current.push(word);
    const next = words[i + 1];
    if (next === undefined) return;
    const gap = Math.round((next.start - word.end) * 1000);
    if (gap >= gapMs && !insideNumber(words, i)) {
      groups.push(current);
      current = [];
    }
  });
  if (current.length > 0) groups.push(current);
  return groups;
}
