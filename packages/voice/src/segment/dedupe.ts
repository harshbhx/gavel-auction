import { PENDING_MAX_AGE_MS } from '../parser/correction.js';
import type { BidderRef, Cents, ParseContext } from '../types.js';

/** The same text again within this window is a replay, not a new bid (R-VOX-032). */
export const DUPLICATE_WINDOW_MS = 1500;

/** Lower case, punctuation removed, single spaces. */
export function normalizeForDedupe(text: string): string {
  return text
    .toLowerCase()
    .replace(/\u2019/g, "'")
    .split(/[^\p{L}\p{N}']+/u)
    .filter((w) => w !== '')
    .join(' ');
}

/** 32-bit FNV-1a with a seed; two seeds give a 64-bit digest without any platform crypto. */
function fnv1a(text: string, seed: number): string {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Stable key: identical (room, lot, audioStartMs, text) always gives the identical key. A stream
 * source or epoch is appended when given, so two microphones at one offset do not collide.
 */
export function idempotencyKey(
  roomId: string,
  lotId: string,
  audioStartMs: number,
  text: string,
  stream?: string,
): string {
  const norm = normalizeForDedupe(text);
  const digest = (fnv1a(norm, 0x811c9dc5) + fnv1a(norm, 0x01000193)).slice(0, 12);
  // ':' inside an id is escaped, so ('a:b', 'c') and ('a', 'b:c') never collide.
  const base = `${encodeURIComponent(roomId)}:${encodeURIComponent(lotId)}:${audioStartMs}:${digest}`;
  return stream === undefined ? base : `${base}:${encodeURIComponent(stream)}`;
}

/** Remembers when each normalized text was last processed. Time is always passed in. */
export class DuplicateFilter {
  private readonly seen = new Map<string, number>();

  constructor(private readonly windowMs: number = DUPLICATE_WINDOW_MS) {}

  /** True when the text was already processed less than the window ago; such a segment is dropped. */
  isDuplicate(text: string, atMs: number): boolean {
    for (const [key, at] of this.seen) {
      if (atMs - at >= this.windowMs) this.seen.delete(key);
    }
    const key = normalizeForDedupe(text);
    const last = this.seen.get(key);
    const duplicate = last !== undefined && atMs >= last && atMs - last < this.windowMs;
    // A dropped duplicate also renews the window, so a replay storm never leaks one through.
    this.seen.set(key, atMs);
    return duplicate;
  }
}

export interface PendingInput {
  id: string;
  bidder: BidderRef | null;
  amountCents: Cents;
}

/** Holds the latest undecided candidate so the parser can read it as ctx.pendingCandidate (R-VOX-034). */
export class PendingCandidateStore {
  private current: { input: PendingInput; atMs: number } | null = null;

  constructor(private readonly maxAgeMs: number = PENDING_MAX_AGE_MS) {}

  set(input: PendingInput, atMs: number): void {
    this.current = { input, atMs };
  }

  clear(): void {
    this.current = null;
  }

  /** The candidate with its age, or undefined once it is older than the maximum age. */
  get(nowMs: number): ParseContext['pendingCandidate'] {
    if (this.current === null) return undefined;
    const ageMs = nowMs - this.current.atMs;
    if (ageMs < 0 || ageMs >= this.maxAgeMs) return undefined;
    return { ...this.current.input, ageMs };
  }
}
