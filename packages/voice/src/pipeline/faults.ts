import type { VoiceReason } from '../types.js';

/** No final for this long while the meter shows speech: status degraded (R-VOX-086). */
export const STT_DEGRADED_MS = 8000;
/** Same, status down. */
export const STT_DOWN_MS = 15_000;
/** Speech counts as "shown by the meter" when seen this recently. */
export const SPEECH_RECENT_MS = 5000;
/** The stt_unavailable event is repeated at most this often (R-VOX-090). */
export const STT_UNAVAILABLE_EVERY_MS = 30_000;
export const MAX_TRANSCRIPT_CHARS = 2000;
export const MAX_CHAR_RUN = 20;

export const FILLERS: ReadonlySet<string> = new Set([
  'uh',
  'um',
  'hmm',
  'mm',
  'mhm',
  'er',
  'erm',
  'ah',
]);

export type TranscriptCheck =
  | { kind: 'ok' }
  | { kind: 'drop'; reason: Extract<VoiceReason, 'empty' | 'no_amount' | 'garbage'> };

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}']+/u)
    .filter((w) => w !== '');
}

function hasRun(text: string, length: number): boolean {
  let run = 0;
  let prev = '';
  for (const ch of text) {
    run = ch === prev ? run + 1 : 1;
    prev = ch;
    if (run >= length) return true;
  }
  return false;
}

/**
 * Cheap pre-parse filter (R-VOX-087, R-VOX-088). A dropped transcript never reaches the language
 * model. Never throws.
 */
export function checkTranscript(text: string): TranscriptCheck {
  if (text.length > MAX_TRANSCRIPT_CHARS) return { kind: 'drop', reason: 'garbage' };
  if (CONTROL.test(text)) return { kind: 'drop', reason: 'garbage' };
  if (hasRun(text, MAX_CHAR_RUN)) return { kind: 'drop', reason: 'garbage' };
  const ws = words(text);
  if (ws.length === 0) return { kind: 'drop', reason: 'empty' };
  const hasLetter = /\p{L}/u.test(text);
  if (hasLetter && !/[A-Za-z]/.test(text)) return { kind: 'drop', reason: 'garbage' };
  if (ws.every((w) => FILLERS.has(w))) return { kind: 'drop', reason: 'no_amount' };
  return { kind: 'ok' };
}

/** Words never shown in captions. Bidding ignores them: amounts are parsed from the raw text. */
const PROFANITY: readonly string[] = ['damn', 'hell', 'crap', 'shit', 'fuck', 'bastard', 'bitch'];
const PROFANITY_RE = new RegExp(`\\b(${PROFANITY.join('|')})\\b`, 'gi');

/** Masks profane words for display, keeping the first letter ("damn" becomes "d***"). */
export function maskProfanity(text: string): string {
  return text.replace(
    PROFANITY_RE,
    (w) => `${w.charAt(0)}${'*'.repeat(Math.max(w.length - 1, 1))}`,
  );
}

export type SttStatus = 'ok' | 'degraded' | 'down';
export type LlmStatus = 'ok' | 'down';
export type BannerId = 'manual_entry' | 'qr_bids';

/** Watches STT liveness from the level meter and finals (R-VOX-086). Time is passed in. */
export class SttWatch {
  private stalledSince: number | null = null;
  private lastSpeechAt = 0;

  /** The level meter shows speech at `nowMs`. */
  noteSpeech(nowMs: number): void {
    this.lastSpeechAt = nowMs;
    if (this.stalledSince === null) this.stalledSince = nowMs;
  }

  /** The provider emitted a final. */
  noteFinal(): void {
    this.stalledSince = null;
  }

  status(nowMs: number): SttStatus {
    if (this.stalledSince === null) return 'ok';
    if (nowMs - this.lastSpeechAt > SPEECH_RECENT_MS) return 'ok';
    const stalled = nowMs - this.stalledSince;
    if (stalled >= STT_DOWN_MS) return 'down';
    if (stalled >= STT_DEGRADED_MS) return 'degraded';
    return 'ok';
  }
}

export interface FaultSnapshot {
  stt: SttStatus;
  llm: LlmStatus;
  /** False when neither speech service can produce a bid (R-VOX-090). */
  bidsAllowed: boolean;
  banners: BannerId[];
}

/**
 * Combines STT and language-model health. A model failure falls back to rules only and recovers on
 * the next success (R-VOX-089); with both down no bid is created and manual entry and QR bids stay
 * on offer (R-VOX-090).
 */
export class FaultTracker {
  private llm: LlmStatus = 'ok';
  private lastUnavailableAt: number | null = null;

  constructor(readonly stt: SttWatch = new SttWatch()) {}

  /** Call with the outcome of every language-model call (timeout, schema failure or 5xx = false). */
  noteLlm(ok: boolean): void {
    this.llm = ok ? 'ok' : 'down';
  }

  snapshot(nowMs: number): FaultSnapshot {
    const stt = this.stt.status(nowMs);
    const bothDown = stt === 'down' && this.llm === 'down';
    const banners: BannerId[] = [];
    if (stt !== 'ok') banners.push('manual_entry');
    if (bothDown) banners.push('qr_bids');
    return { stt, llm: this.llm, bidsAllowed: !bothDown, banners };
  }

  /** True when an stt_unavailable event should be emitted now; at most once per 30 s. */
  shouldEmitUnavailable(nowMs: number): boolean {
    if (this.snapshot(nowMs).bidsAllowed) return false;
    if (
      this.lastUnavailableAt !== null &&
      nowMs - this.lastUnavailableAt < STT_UNAVAILABLE_EVERY_MS
    ) {
      return false;
    }
    this.lastUnavailableAt = nowMs;
    return true;
  }
}
