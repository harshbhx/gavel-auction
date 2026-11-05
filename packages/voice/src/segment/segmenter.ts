import { parseBid } from '../parser/parse.js';
import type { SttEvent, SttWord } from '../stt/provider.js';
import { DuplicateFilter, PendingCandidateStore } from './dedupe.js';
import { splitEcho } from './echo.js';
import { GAP_SPLIT_MS, splitAtGaps } from './split.js';

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
  /** True when auctioneer echo was cut out of the text and a bid remains (R-VOX-031). */
  echo?: boolean;
}

export type SegmentDropReason = 'empty' | 'too_long' | 'auctioneer_talk' | 'duplicate';

export type SegmentEvent =
  | { type: 'caption'; text: string; final: boolean; startMs: number }
  | { type: 'segment'; segment: Segment }
  | { type: 'drop'; reason: SegmentDropReason; segment: Segment };

export interface SegmenterOptions {
  /** A lone final with no follow-up becomes a segment after this long. */
  holdMs?: number;
  maxDurationMs?: number;
  maxWords?: number;
  /** Silence that ends a segment inside one merged final (R-VOX-029). */
  gapSplitMs?: number;
  /** Window in which the same text again is a replay (R-VOX-032). */
  duplicateWindowMs?: number;
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
  private readonly gapSplitMs: number;
  private readonly duplicates: DuplicateFilter;
  /** Latest undecided candidate; the pipeline sets it after a decision (R-VOX-034). */
  readonly pending: PendingCandidateStore = new PendingCandidateStore();

  constructor(opts: SegmenterOptions = {}) {
    this.holdMs = opts.holdMs ?? DEFAULT_HOLD_MS;
    this.maxDurationMs = opts.maxDurationMs ?? MAX_SEGMENT_MS;
    this.maxWords = opts.maxWords ?? MAX_SEGMENT_WORDS;
    this.gapSplitMs = opts.gapSplitMs ?? GAP_SPLIT_MS;
    this.duplicates =
      opts.duplicateWindowMs === undefined
        ? new DuplicateFilter()
        : new DuplicateFilter(opts.duplicateWindowMs);
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
    const words = parts.flatMap((p) => p.words);
    const merged = parts
      .map((p) => p.text.trim())
      .filter((t) => t !== '')
      .join(' ');
    const confidence = Math.min(...parts.map((p) => p.confidence));
    const groups = words.length > 1 ? splitAtGaps(words, this.gapSplitMs) : [words];
    if (groups.length <= 1) {
      return this.emit({
        seq: ++this.seq,
        text: merged,
        words,
        startMs: first.startMs,
        endMs: last.endMs,
        confidence,
      });
    }
    const out: SegmentEvent[] = [];
    for (const group of groups) {
      const head = group[0];
      const tail = group[group.length - 1];
      if (head === undefined || tail === undefined) continue;
      out.push(
        ...this.emit({
          seq: ++this.seq,
          text: group
            .map((w) => w.word.trim())
            .filter((w) => w !== '')
            .join(' '),
          words: group,
          startMs: Math.round(head.start * 1000),
          endMs: Math.round(tail.end * 1000),
          confidence: Math.min(confidence, ...group.map((w) => w.confidence)),
        }),
      );
    }
    return out;
  }

  /** Length limits, echo gate and duplicate filter for one finished segment. */
  private emit(base: Segment): SegmentEvent[] {
    let segment = base;
    if (segment.text === '') return [{ type: 'drop', reason: 'empty', segment }];
    const wordCount = segment.text.split(/\s+/).length;
    if (segment.endMs - segment.startMs > this.maxDurationMs || wordCount > this.maxWords) {
      return [{ type: 'drop', reason: 'too_long', segment }];
    }
    const echo = splitEcho(segment.text, hasPaddleBid);
    if (echo.kind === 'echo') return [{ type: 'drop', reason: 'auctioneer_talk', segment }];
    if (echo.kind === 'mixed') segment = { ...segment, text: echo.text, echo: true };
    if (this.duplicates.isDuplicate(segment.text, this.lastNow)) {
      return [{ type: 'drop', reason: 'duplicate', segment }];
    }
    return [{ type: 'segment', segment }];
  }
}

/** True when the text parses to a bid or a confirm that names a paddle and an amount. */
function hasPaddleBid(text: string): boolean {
  const r = parseBid(text);
  if (r.status === 'none') return false;
  const paddle =
    r.bidder?.kind === 'paddle' || r.candidates.some((c) => c.bidder?.kind === 'paddle');
  const amount = r.amountCents !== null || r.candidates.some((c) => c.amountCents !== null);
  return paddle && amount;
}
