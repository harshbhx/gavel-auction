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

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’]/g, "'")
    .split(/[^\p{L}\p{N}']+/u)
    .filter((w) => w !== '');
}

/** True when the text contains one of the echo phrases as whole words. */
export function isAuctioneerEcho(text: string): boolean {
  const joined = ` ${words(text).join(' ')} `;
  return ECHO_PHRASES.some((p) => joined.includes(` ${p} `));
}

export type EchoGate<T> =
  | { dropped: true; reason: Extract<VoiceReason, 'auctioneer_talk'> }
  | { dropped: false; result: T };

/** Runs `parse` only when the text is not auctioneer echo, so echo never reaches the parser. */
export function parseUnlessEcho<T>(text: string, parse: (text: string) => T): EchoGate<T> {
  if (isAuctioneerEcho(text)) return { dropped: true, reason: 'auctioneer_talk' };
  return { dropped: false, result: parse(text) };
}
