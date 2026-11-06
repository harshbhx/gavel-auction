import type { VoiceReason } from '../types.js';

/** Auctioneer phrases that echo the room state back; never a bid (R-VOX-031). */
export const ECHO_PHRASES: readonly string[] = [
  'going once',
  'going twice',
  'going three times',
  'fair warning',
  'sold',
  'the price is',
];

/** Auctioneer solicitations and calls for the next increment; heard on a bidder's own device mic they are not a bid. */
export const PATTER_PHRASES: readonly string[] = [
  'who will give me',
  'who will give',
  'who ll give me',
  'do i hear',
  'do i have',
  'can i get',
  'can i have',
  'anyone',
  'anybody',
  'any advance',
  'any more',
  'looking for',
  'i have',
  'i m bid',
  'i am bid',
  'all done',
  'all in',
  'give me',
  'will you give',
  'come on',
  'it s against you',
  'new bidder',
];

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\u2019/g, "'")
    .split(/[^\p{L}\p{N}']+/u)
    .filter((w) => w !== '');
}

/** True when the text contains one of the echo phrases as whole words. */
export function isAuctioneerEcho(text: string): boolean {
  const joined = ` ${words(text).join(' ')} `;
  return ECHO_PHRASES.some((p) => joined.includes(` ${p} `));
}

/**
 * True when the text sounds like auctioneer patter: a solicitation phrase, an echo phrase, or the
 * same number called out more than once ("six hundred, six hundred"). Such text on a device mic may
 * come from the room rather than from the phone owner, so it is never auto-accepted.
 */
export function isAuctioneerPatter(text: string): boolean {
  if (isAuctioneerEcho(text)) return true;
  const joined = ` ${text
    .toLowerCase()
    .replace(/[\u2019']/g, ' ')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w !== '')
    .join(' ')} `;
  if (PATTER_PHRASES.some((p) => joined.includes(` ${p} `))) return true;
  if (/\?\s*$/.test(text.trim())) return true;
  // Repeated phrase: "six hundred six hundred", "600 600".
  const w = joined.trim().split(' ');
  for (let n = 1; n <= 3; n += 1) {
    for (let i = 0; i + 2 * n <= w.length; i += 1) {
      if (w.slice(i, i + n).join(' ') === w.slice(i + n, i + 2 * n).join(' ')) {
        const unit = w.slice(i, i + n);
        if (unit.some((x) => /^\d/.test(x) || NUMWORDS.has(x))) return true;
      }
    }
  }
  return false;
}

const NUMWORDS = new Set([
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
  'hundred',
  'thousand',
  'grand',
]);

export type EchoGate<T> =
  | { dropped: true; reason: Extract<VoiceReason, 'auctioneer_talk'> }
  | { dropped: false; result: T };

/** Runs `parse` only when the text is not auctioneer echo, so echo never reaches the parser. */
export function parseUnlessEcho<T>(text: string, parse: (text: string) => T): EchoGate<T> {
  if (isAuctioneerEcho(text)) return { dropped: true, reason: 'auctioneer_talk' };
  return { dropped: false, result: parse(text) };
}

function token(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, '');
}

const ECHO_TOKENS: readonly (readonly string[])[] = ECHO_PHRASES.map((p) => p.split(' '));

/**
 * Removes every echo phrase from the text and returns what is left, keeping the original spelling
 * of the remaining words. `found` says whether anything was removed.
 */
export function stripEcho(text: string): { text: string; found: boolean } {
  const raw = text.split(/\s+/).filter((w) => w !== '');
  const norm = raw.map(token);
  const kept: string[] = [];
  let found = false;
  let i = 0;
  while (i < raw.length) {
    const hit = ECHO_TOKENS.find((phrase) => phrase.every((w, k) => norm[i + k] === w));
    if (hit !== undefined) {
      found = true;
      i += hit.length;
      continue;
    }
    const word = raw[i];
    if (word !== undefined) kept.push(word);
    i += 1;
  }
  return { text: kept.join(' '), found };
}

export type EchoSplit =
  | { kind: 'clean'; text: string }
  | { kind: 'echo' }
  /** Echo mixed with a real bid: the remainder still names a paddle and an amount. */
  | { kind: 'mixed'; text: string };

/**
 * Classifies a segment text. Pure echo is dropped; echo that sits next to a paddle and an amount
 * keeps the remainder so the bid is not lost at the closing moment (R-VOX-031, R-VOX-092).
 * `hasBid` tells whether a text names a paddle and an amount.
 */
export function splitEcho(text: string, hasBid: (text: string) => boolean): EchoSplit {
  if (!isAuctioneerEcho(text)) return { kind: 'clean', text };
  const rest = stripEcho(text);
  if (rest.text !== '' && hasBid(rest.text)) return { kind: 'mixed', text: rest.text };
  return { kind: 'echo' };
}
