import type { SttEvent, SttWord } from '../stt/provider.js';

/** A final transcript chunk after segmentation: the unit given to the parser (SPEC-voice section 2). */
export interface Segment {
  /** Sequence number from 1; the pipeline assigns the public segment id. */
  seq: number;
  text: string;
  words: SttWord[];
  startMs: number;
  endMs: number;
  /** Lowest confidence among the finals that were merged into this segment. */
  confidence: number;
}

export type SegmentDropReason = 'empty' | 'too_long';

export type SegmentEvent =
  | { type: 'caption'; text: string; final: boolean; startMs: number }
  | { type: 'segment'; segment: Segment }
  | { type: 'drop'; reason: SegmentDropReason; segment: Segment };

export interface SegmenterOptions {
  /** A lone final with no follow-up becomes a segment after this long. */
  holdMs?: number;
  maxDurationMs?: number;
  maxWords?: number;
}

export const DEFAULT_HOLD_MS = 1500;
export const MAX_SEGMENT_MS = 12_000;
export const MAX_SEGMENT_WORDS = 40;

type FinalEvent = Extract<SttEvent, { type: 'final' }>;

/**
 * Turns STT events into segments (R-VOX-027, 028, 033). Pure: time only arrives as arguments.
 * Interims are captions and never produce a segment. Finals that are not speechFinal are held and
 * merged until speechFinal, utterance_end, or holdMs without a newer interim.
 */
export class Segmenter {
  private readonly holdMs: number;
  private readonly maxDurationMs: number;
  private readonly maxWords: number;
  private parts: FinalEvent[] = [];
  private lastFinalAt = 0;
  private interimSinceFinal = false;
  private lastNow = 0;
  private seq = 0;

  constructor(opts: SegmenterOptions = {}) {
    this.holdMs = opts.holdMs ?? DEFAULT_HOLD_MS;
    this.maxDurationMs = opts.maxDurationMs ?? MAX_SEGMENT_MS;
    this.maxWords = opts.maxWords ?? MAX_SEGMENT_WORDS;
  }

  /** `nowMs` is when the event arrived; it defaults to the time of the last push or tick. */
  push(ev: SttEvent, nowMs: number = this.lastNow): SegmentEvent[] {
    this.lastNow = nowMs;
    switch (ev.type) {
      case 'interim': {
        // A blank interim is a silence keep-alive: it must not postpone the flush of a held final.
        if (ev.text.trim() === '') return [];
        if (this.parts.length > 0) this.interimSinceFinal = true;
        return [{ type: 'caption', text: ev.text, final: false, startMs: ev.startMs }];
      }
      case 'final': {
        const out: SegmentEvent[] = [];
        if (ev.text.trim() !== '') {
          out.push({ type: 'caption', text: ev.text, final: true, startMs: ev.startMs });
        }
        this.parts.push(ev);
        this.lastFinalAt = nowMs;
        this.interimSinceFinal = false;
        if (ev.speechFinal) out.push(...this.flushParts());
        return out;
      }
      case 'utterance_end':
        return this.flushParts();
      case 'error':
      case 'state':
        return [];
    }
  }

  /** Call as time passes; emits a lone final that has waited holdMs with no newer interim. */
  tick(nowMs: number): SegmentEvent[] {
    this.lastNow = nowMs;
    if (this.parts.length === 0 || this.interimSinceFinal) return [];
    if (nowMs - this.lastFinalAt < this.holdMs) return [];
    return this.flushParts();
  }

  /** Emit whatever is held, for shutdown. */
  flush(): SegmentEvent[] {
    return this.flushParts();
  }

  private flushParts(): SegmentEvent[] {
    if (this.parts.length === 0) return [];
    const parts = this.parts;
    this.parts = [];
    this.interimSinceFinal = false;
    const first = parts[0];
    const last = parts[parts.length - 1];
    if (first === undefined || last === undefined) return [];
    const text = parts
      .map((p) => p.text.trim())
      .filter((t) => t !== '')
      .join(' ');
    const segment: Segment = {
      seq: ++this.seq,
      text,
      words: parts.flatMap((p) => p.words),
      startMs: first.startMs,
      endMs: last.endMs,
      confidence: Math.min(...parts.map((p) => p.confidence)),
    };
    if (text === '') return [{ type: 'drop', reason: 'empty', segment }];
    const wordCount = text.split(/\s+/).length;
    if (segment.endMs - segment.startMs > this.maxDurationMs || wordCount > this.maxWords) {
      return [{ type: 'drop', reason: 'too_long', segment }];
    }
    return [{ type: 'segment', segment }];
  }
}
