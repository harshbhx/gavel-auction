import type { ParseFlag } from '../types.js';

export type MergeOutcome = 'agree' | 'agree_clean' | 'model_unavailable';

export interface ScoreInput {
  flags: readonly ParseFlag[];
  /** Word confidences (0..1) over the amount and paddle spans; empty when the provider gives none. */
  wordConfidences: readonly number[];
  /** Whole-transcript confidence (0..1) of the segment, e.g. Groq's; used when there are no word confidences. */
  segmentConfidence?: number;
  merge: MergeOutcome;
  homophonePossible?: boolean;
  /** Number of words in the utterance. */
  wordCount?: number;
}

export const BASE = 0.97;
export const CAP = 0.99;
const STT_REFERENCE = 0.85;
const STT_UNKNOWN = 0.9;
const MAX_REPAIRS = 2;
const MANY_TOKENS = 10;

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function sttFactor(words: readonly number[], segment?: number): number {
  if (words.length === 0) {
    return segment === undefined ? STT_UNKNOWN : clamp01(segment / STT_REFERENCE);
  }
  return clamp01(Math.min(...words) / STT_REFERENCE);
}

function penalties(input: ScoreInput): number {
  let p = 1;
  const repairs = input.flags.filter((f) => f === 'asr_repair').length;
  p *= Math.pow(0.9, Math.min(repairs, MAX_REPAIRS));
  if (input.flags.includes('colloquial_hundreds')) p *= 0.95;
  if (input.flags.includes('make_it')) p *= 0.95;
  if (input.homophonePossible === true) p *= 0.8;
  if ((input.wordCount ?? 0) > MANY_TOKENS) p *= 0.95;
  return p;
}

function mergeFactor(merge: MergeOutcome): number {
  if (merge === 'agree_clean') return 1.02;
  if (merge === 'model_unavailable') return 0.85;
  return 1;
}

/** Section 8 confidence: deterministic, capped at 0.99, rounded to 2 decimals. */
export function score(input: ScoreInput): number {
  const raw =
    BASE *
    sttFactor(input.wordConfidences, input.segmentConfidence) *
    penalties(input) *
    mergeFactor(input.merge);
  return Math.round(Math.min(CAP, raw) * 100) / 100;
}
