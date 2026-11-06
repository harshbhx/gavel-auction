import { answerConfirm, parseSpokenAnswer, type AnswerOutcome } from '../decide/answer.js';
import { score } from '../decide/score.js';
import { merge } from '../decide/merge.js';
import { classify, DEFAULT_POLICY, type PolicyConfig } from '../decide/policy.js';
import { PromptBook } from '../decide/prompts.js';
import { validate, type Verdict } from '../decide/validate.js';
import { formatUsd, promptText, type PromptData } from '../decide/wording.js';
import { parseUtteranceOutcome } from '../parser/utterance.js';
import { isAuctioneerPatter } from '../segment/echo.js';
import { idempotencyKey } from '../segment/dedupe.js';
import { Segmenter, type Segment, type SegmenterOptions } from '../segment/segmenter.js';
import type { SttEvent } from '../stt/provider.js';
import type {
  BidContext,
  Cents,
  ConfirmPrompt,
  Decision,
  ParseContext,
  ParseResult,
  PipelineEvent,
  VoiceEvidence,
  VoiceReason,
} from '../types.js';
import { checkTranscript, FaultTracker } from './faults.js';

/** A segment decided later than this after its audio ended is dropped (R-VOX-093). */
export const STALE_SEGMENT_MS = 5000;
/** A retraction reaches an accepted bid within this window only as an advisory (R-VOX-044). */
export const RETRACT_ADVISORY_MS = 8000;

/** Pipeline output: the public events plus audit notes and console advisories. */
export type PipelineOutput =
  | PipelineEvent
  | {
      type: 'audit';
      audit: 'stale_segment' | 'confirm_expired' | 'superseded' | 'rate_limited';
      id: string;
    }
  | { type: 'confirm_cancelled'; promptId: string }
  | {
      type: 'advisory';
      advisory: 'retract_after_accept';
      bidderId: string;
      amountCents: Cents;
      segmentId: string;
    }
  | { type: 'answer'; promptId: string; outcome: AnswerOutcome };

export interface PipelineDeps {
  roomId: string;
  lotId: string;
  /** Milliseconds on the same timeline as the STT audio offsets. Never Date.now. */
  clock: () => number;
  /** Segment ids. Never random. */
  ids: () => string;
  /** Current auction state; `nowMs` is overwritten with the clock. */
  context: () => BidContext;
  /** Cached or injected model output for a transcript; null when off or no answer. May throw. */
  llm?: (text: string, ctx: ParseContext) => ParseResult | null;
  policy?: PolicyConfig;
  segmenter?: SegmenterOptions;
  sttProvider?: string;
  replay?: boolean;
  /** Device mic means one bidder speaks; room mic means a shared microphone. */
  mic?: 'device' | 'room';
  speakerBidderId?: string;
}

interface Accepted {
  bidderId: string;
  amountCents: Cents;
  atMs: number;
}

/**
 * Orchestrates one room and lot: STT events to segments, rules and model parses merged, policy
 * and validation, prompts, and decisions (SPEC-voice). Deterministic: time and ids are injected.
 */
export class VoicePipeline {
  private readonly segmenter: Segmenter;
  private readonly book: PromptBook<null>;
  private readonly open = new Map<string, ConfirmPrompt>();
  private readonly faults = new FaultTracker();
  private readonly accepted: Accepted[] = [];
  private lastStatus = '';

  constructor(private readonly deps: PipelineDeps) {
    this.segmenter = new Segmenter(deps.segmenter);
    this.book = new PromptBook<null>(deps.clock);
  }

  /** Feed one STT event. */
  push(ev: SttEvent): PipelineOutput[] {
    const now = this.deps.clock();
    if (ev.type === 'final') this.faults.stt.noteFinal();
    return [...this.handle(this.segmenter.push(ev, now), now), ...this.housekeeping(now)];
  }

  /** Call as time passes: flushes held finals, expires prompts, reports status changes. */
  tick(): PipelineOutput[] {
    const now = this.deps.clock();
    return [...this.handle(this.segmenter.tick(now), now), ...this.housekeeping(now)];
  }

  /** The level meter shows speech now (drives the STT health status). */
  noteSpeech(): void {
    this.faults.stt.noteSpeech(this.deps.clock());
  }

  /** Answer an open prompt; the chosen option is re-validated against fresh state. */
  answer(
    promptId: string,
    optionId: string | null,
    by: 'bidder' | 'auctioneer' | 'voice',
  ): AnswerOutcome {
    const prompt = this.open.get(promptId);
    // Expiries found here are kept for the next push or tick so none go unaudited (R9-V03).
    for (const a of this.book.sweep()) this.audit(this.deferred, a.reason, a.promptId, a.promptId);
    const taken = this.book.take(promptId);
    this.open.delete(promptId);
    // An answered, expired or swept prompt never leaves its pending candidate behind (R10-V03).
    this.clearPendingFor(promptId);
    if (taken.status !== 'ok' || prompt === undefined) {
      return { kind: 'dropped', reason: 'low_confidence', message: 'That question expired.' };
    }
    const outcome = answerConfirm({
      prompt,
      ctx: this.freshContext(),
      optionId,
      by,
    });
    if (outcome.kind === 'bid') this.noteAccepted(outcome.bidderId, outcome.amountCents);
    return outcome;
  }

  private freshContext(): BidContext {
    return { ...this.deps.context(), nowMs: this.deps.clock() };
  }

  private noteAccepted(bidderId: string, amountCents: Cents): void {
    const now = this.deps.clock();
    this.pruneAccepted(now);
    this.accepted.push({ bidderId, amountCents, atMs: now });
  }

  /** A retraction only looks RETRACT_ADVISORY_MS back, so older entries are dropped. */
  private pruneAccepted(now: number): void {
    let drop = 0;
    while (drop < this.accepted.length) {
      const a = this.accepted[drop];
      if (a !== undefined && now - a.atMs >= RETRACT_ADVISORY_MS) drop += 1;
      else break;
    }
    if (drop > 0) this.accepted.splice(0, drop);
  }

  private readonly deferred: PipelineOutput[] = [];

  private housekeeping(now: number): PipelineOutput[] {
    const out: PipelineOutput[] = this.deferred.splice(0);
    this.pruneAccepted(now);
    for (const a of this.book.sweep()) this.audit(out, a.reason, a.promptId, a.promptId);
    const snap = this.faults.snapshot(now);
    const llm = this.deps.llm === undefined ? 'off' : snap.llm;
    const status = `${snap.stt}/${llm}`;
    if (status !== this.lastStatus) {
      this.lastStatus = status;
      out.push({ type: 'status', stt: snap.stt, llm, droppedFrames: 0 });
    }
    return out;
  }

  private clearPendingFor(promptId: string): void {
    if (this.segmenter.pending.get(this.deps.clock())?.id === promptId) {
      this.segmenter.pending.clear();
    }
  }

  private audit(
    out: PipelineOutput[],
    reason: 'confirm_expired' | 'superseded' | 'low_confidence',
    promptId: string,
    id: string,
  ): void {
    this.open.delete(promptId);
    this.clearPendingFor(promptId);
    if (reason === 'confirm_expired') {
      out.push({ type: 'confirm_expired', promptId });
      out.push({ type: 'audit', audit: 'confirm_expired', id });
    } else if (reason === 'superseded') {
      out.push({ type: 'audit', audit: 'superseded', id });
    }
  }

  private handle(events: ReturnType<Segmenter['push']>, now: number): PipelineOutput[] {
    const out: PipelineOutput[] = [];
    for (const e of events) {
      if (e.type === 'caption') {
        out.push({ type: 'caption', text: e.text, final: e.final });
      } else if (e.type === 'drop') {
        out.push(this.drop(e.segment, e.reason, this.none(e.reason)));
      } else {
        out.push(...this.decide(e.segment, now));
      }
    }
    return out;
  }

  private none(reason: VoiceReason): ParseResult {
    return {
      status: 'none',
      bidder: null,
      amountCents: null,
      reason,
      candidates: [],
      flags: [],
      confidence: 0,
      source: 'rules',
    };
  }

  private evidence(
    seg: Segment,
    segmentId: string,
    rules: ParseResult,
    llm: ParseResult | null,
    confidence: number,
    reason: VoiceReason,
  ): VoiceEvidence {
    return {
      segmentId,
      idempotencyKey: idempotencyKey(this.deps.roomId, this.deps.lotId, seg.startMs, seg.text),
      transcript: seg.text,
      audioStartMs: seg.startMs,
      audioEndMs: seg.endMs,
      sttProvider: this.deps.sttProvider ?? 'fake',
      sttConfidence: seg.confidence,
      replay: this.deps.replay ?? false,
      rules,
      llm,
      confidence,
      reason,
    };
  }

  private drop(seg: Segment, reason: VoiceReason, rules: ParseResult): PipelineOutput {
    const decision: Decision = {
      kind: 'drop',
      reason,
      evidence: this.evidence(seg, this.deps.ids(), rules, null, rules.confidence, reason),
    };
    return { type: 'decision', decision };
  }

  private decide(seg: Segment, now: number): PipelineOutput[] {
    // Stale audio (before a restart or reconnect) is never replayed (R-VOX-093).
    if (now - seg.endMs > STALE_SEGMENT_MS) {
      const dropped = this.drop(seg, 'low_confidence', this.none('low_confidence'));
      const id = dropped.type === 'decision' ? dropped.decision.evidence.segmentId : '';
      return [dropped, { type: 'audit', audit: 'stale_segment', id }];
    }
    const segmentId = this.deps.ids();
    const check = checkTranscript(seg.text);
    if (check.kind === 'drop') {
      const rules = this.none(check.reason);
      return [this.decision(seg, segmentId, rules, null, { kind: 'drop', reason: check.reason })];
    }
    if (!this.faults.snapshot(now).bidsAllowed) {
      const rules = this.none('stt_unavailable');
      return [
        this.decision(seg, segmentId, rules, null, { kind: 'drop', reason: 'stt_unavailable' }),
      ];
    }

    const ctx = this.freshContext();
    const spoken = this.spokenAnswer(seg);
    if (spoken !== null) return spoken;

    const pending = this.segmenter.pending.get(now);
    let speakerPaddle: string | undefined;
    if (this.deps.speakerBidderId !== undefined) {
      for (const [label, entry] of ctx.roster) {
        if (entry.bidderId === this.deps.speakerBidderId) speakerPaddle = label;
      }
    }
    const pctx: ParseContext = {
      currentPriceCents: ctx.currentPriceCents,
      minIncrementCents: ctx.minIncrementCents,
      ...(this.deps.speakerBidderId === undefined
        ? {}
        : { speakerBidderId: this.deps.speakerBidderId }),
      ...(speakerPaddle === undefined ? {} : { speakerPaddle }),
      ...(pending === undefined ? {} : { pendingCandidate: pending }),
      sttWordConfidence: seg.words.map((w) => ({
        word: w.word,
        start: Math.round(w.start * 1000),
        end: Math.round(w.end * 1000),
        confidence: w.confidence,
      })),
    };
    const parsed = parseUtteranceOutcome(seg.text, pctx);
    const rules = parsed.result;

    if (rules.reason === 'retract' && rules.status === 'none') {
      return this.retract(seg, segmentId, rules, parsed.cancelPending, pending?.id, ctx);
    }

    let llm: ParseResult | null = null;
    if (this.deps.llm !== undefined) {
      try {
        llm = this.deps.llm(seg.text, pctx);
        this.faults.noteLlm(true);
      } catch {
        this.faults.noteLlm(false);
      }
    }
    const merged = this.rescore(merge(rules, llm), seg, llm !== null);
    return this.finish(seg, segmentId, rules, llm, merged, ctx, pending?.amountCents);
  }

  /**
   * Section 8 confidence for a clean bid: the parser's placeholder 1.0 never decides alone, the
   * speech-to-text confidence (word level, else segment level) and the parse flags are applied.
   */
  private rescore(merged: ParseResult, seg: Segment, hasModel: boolean): ParseResult {
    if (merged.status !== 'bid') return merged;
    const confidence = score({
      flags: merged.flags,
      wordConfidences: seg.words.map((w) => w.confidence),
      segmentConfidence: seg.confidence,
      // No model reading means the "model unavailable" factor applies (section 8): a rules-only
      // bid scores below the auto threshold and asks for a confirm.
      merge: !hasModel ? 'model_unavailable' : merged.flags.length === 0 ? 'agree_clean' : 'agree',
    });
    return { ...merged, confidence: Math.min(merged.confidence, confidence) };
  }

  /** A retraction cancels only a fresh pending candidate; an accepted bid gets an advisory. */
  private retract(
    seg: Segment,
    segmentId: string,
    rules: ParseResult,
    cancel: boolean,
    pendingId: string | undefined,
    ctx: BidContext,
  ): PipelineOutput[] {
    const out: PipelineOutput[] = [
      this.decision(seg, segmentId, rules, null, { kind: 'drop', reason: 'retract' }),
    ];
    if (cancel && pendingId !== undefined) {
      this.segmenter.pending.clear();
      if (this.open.has(pendingId)) {
        this.book.take(pendingId);
        this.open.delete(pendingId);
        out.push({ type: 'confirm_cancelled', promptId: pendingId });
      }
      return out;
    }
    const last = this.lastAccepted(ctx);
    if (last !== null) {
      out.push({
        type: 'advisory',
        advisory: 'retract_after_accept',
        bidderId: last.bidderId,
        amountCents: last.amountCents,
        segmentId,
      });
    }
    return out;
  }

  private lastAccepted(ctx: BidContext): Accepted | null {
    const all: Accepted[] = [
      ...this.accepted,
      ...ctx.recent.map((r) => ({
        bidderId: r.bidderId,
        amountCents: r.amountCents,
        atMs: r.atMs,
      })),
    ];
    let best: Accepted | null = null;
    for (const a of all) {
      const age = ctx.nowMs - a.atMs;
      if (age < 0 || age >= RETRACT_ADVISORY_MS) continue;
      if (best === null || a.atMs > best.atMs) best = a;
    }
    return best;
  }

  private spokenAnswer(seg: Segment): PipelineOutput[] | null {
    if (this.open.size !== 1) return null;
    const prompt = [...this.open.values()][0];
    if (prompt === undefined) return null;
    const answer = parseSpokenAnswer(seg.text, prompt, {
      mic: this.deps.mic ?? 'room',
      speakerBidderId: this.deps.speakerBidderId ?? null,
      openPrompts: this.open.size,
    });
    if (answer === 'ignore') return null;
    const optionId = answer === 'yes' ? (prompt.options[0]?.id ?? null) : null;
    return [
      {
        type: 'answer',
        promptId: prompt.promptId,
        outcome: this.answer(prompt.promptId, optionId, 'voice'),
      },
    ];
  }

  private decision(
    seg: Segment,
    segmentId: string,
    rules: ParseResult,
    llm: ParseResult | null,
    verdict: Extract<Verdict, { kind: 'accept' | 'drop' }>,
    confidence: number = rules.confidence,
  ): PipelineOutput {
    const reason: VoiceReason = verdict.kind === 'accept' ? 'ok' : verdict.reason;
    const evidence = this.evidence(seg, segmentId, rules, llm, confidence, reason);
    if (verdict.kind === 'drop') {
      return { type: 'decision', decision: { kind: 'drop', reason, evidence } };
    }
    if (verdict.kind === 'accept') {
      this.noteAccepted(verdict.bidderId, verdict.amountCents);
      return {
        type: 'decision',
        decision: {
          kind: 'accept',
          bidderId: verdict.bidderId,
          amountCents: verdict.amountCents,
          confidence,
          evidence,
        },
      };
    }
    return { type: 'decision', decision: { kind: 'drop', reason, evidence } };
  }

  private finish(
    seg: Segment,
    segmentId: string,
    rules: ParseResult,
    llm: ParseResult | null,
    merged: ParseResult,
    ctx: BidContext,
    pendingCents: Cents | undefined,
  ): PipelineOutput[] {
    const verdict = validate(merged, ctx);
    const base = classify(merged, this.deps.policy ?? DEFAULT_POLICY);
    // Auctioneer echo was cut out of this segment: the bid next to it is never taken on its own.
    // A shared room microphone also hears the auctioneer, so a bid on it is confirmed first (R12-V02).
    // On a bidder's own device mic the room can leak in: patter, or an amount with no spoken paddle,
    // is confirmed with the phone owner instead of being booked as their bid (R12-V02b).
    const deviceDoubt =
      this.deps.mic !== 'room' &&
      (isAuctioneerPatter(seg.text) ||
        (this.deps.mic === 'device' && merged.bidder?.kind === 'speaker'));
    const cls =
      base === 'accept' && (seg.echo === true || this.deps.mic === 'room' || deviceDoubt)
        ? 'confirm'
        : base;
    const conf = merged.confidence;
    if (verdict.kind === 'drop') return [this.decision(seg, segmentId, rules, llm, verdict, conf)];
    if (verdict.kind === 'accept' && cls === 'accept') {
      return [this.decision(seg, segmentId, rules, llm, verdict, conf)];
    }
    if (cls === 'drop') {
      const why: VoiceReason = merged.status === 'none' ? merged.reason : 'low_confidence';
      return [this.decision(seg, segmentId, rules, llm, { kind: 'drop', reason: why }, conf)];
    }
    // Confirm path: either the validator or the policy asks for a question.
    const reason: VoiceReason = verdict.kind === 'confirm' ? verdict.reason : merged.reason;
    const bidderId = verdict.bidderId;
    const amounts: Cents[] =
      verdict.kind === 'accept'
        ? [verdict.amountCents]
        : [...(verdict.candidates ?? (verdict.amountCents === null ? [] : [verdict.amountCents]))];
    const choices = verdict.kind === 'confirm' ? verdict.choices : undefined;
    return this.openPrompt(
      seg,
      segmentId,
      rules,
      llm,
      merged,
      ctx,
      reason,
      bidderId,
      amounts,
      pendingCents,
      choices,
    );
  }

  private openPrompt(
    seg: Segment,
    segmentId: string,
    rules: ParseResult,
    llm: ParseResult | null,
    merged: ParseResult,
    ctx: BidContext,
    reason: VoiceReason,
    bidderId: string | null,
    amounts: Cents[],
    pendingCents: Cents | undefined,
    choices?: readonly { bidderId: string; amountCents: Cents }[],
  ): PipelineOutput[] {
    const evidence = this.evidence(seg, segmentId, rules, llm, merged.confidence, reason);
    const paddle = this.paddleOf(bidderId, merged, ctx);
    const ca = choices?.[0];
    const cb = choices?.[1];
    const anon = { ...merged, bidder: null };
    const pa = ca === undefined ? null : this.paddleOf(ca.bidderId, anon, ctx);
    const pb = cb === undefined ? null : this.paddleOf(cb.bidderId, anon, ctx);
    const data: PromptData =
      ca !== undefined && cb !== undefined && pa !== null && pb !== null
        ? {
            kind: 'two_bidders',
            paddleA: pa,
            amountACents: ca.amountCents,
            paddleB: pb,
            amountBCents: cb.amountCents,
          }
        : this.promptData(reason, amounts, paddle, ctx, seg.text, pendingCents);
    const opened = this.book.open(bidderId ?? 'unknown', null);
    const audits: PipelineOutput[] = [];
    for (const a of opened.audit) {
      if (a.reason === 'superseded') this.open.delete(a.promptId);
      if (a.reason === 'superseded' || a.reason === 'confirm_expired') {
        this.audit(audits, a.reason, a.promptId, a.promptId);
      }
    }
    if (!opened.opened) {
      audits.push({ type: 'audit', audit: 'rate_limited', id: segmentId });
      const rejected: Decision = { kind: 'drop', reason: 'low_confidence', evidence };
      return [...audits, { type: 'decision', decision: rejected }];
    }
    const p = opened.prompt;
    const prompt: ConfirmPrompt = {
      promptId: p.promptId,
      text: promptText(data),
      ttlMs: p.expiresAtMs - p.openedAtMs,
      expiresAtMs: p.expiresAtMs,
      defaultAction: 'drop',
      options:
        choices !== undefined && choices.length > 0
          ? choices.map((c, i) => ({
              id: `opt-${i + 1}`,
              label: formatUsd(c.amountCents),
              bidderId: c.bidderId,
              amountCents: c.amountCents,
            }))
          : bidderId === null
            ? []
            : amounts.map((amountCents, i) => ({
                id: `opt-${i + 1}`,
                label: formatUsd(amountCents),
                bidderId,
                amountCents,
              })),
      spokenAnswerAllowed:
        (this.deps.mic ?? 'room') === 'device' &&
        bidderId !== null &&
        bidderId === this.deps.speakerBidderId,
    };
    this.open.set(prompt.promptId, prompt);
    const first = amounts[0];
    if (first !== undefined) {
      this.segmenter.pending.set(
        { id: prompt.promptId, bidder: merged.bidder, amountCents: first },
        this.deps.clock(),
      );
    }
    return [...audits, { type: 'decision', decision: { kind: 'confirm', prompt, evidence } }];
  }

  private paddleOf(bidderId: string | null, merged: ParseResult, ctx: BidContext): string | null {
    if (merged.bidder?.kind === 'paddle') return merged.bidder.value;
    if (bidderId === null) return null;
    for (const [paddle, entry] of ctx.roster) if (entry.bidderId === bidderId) return paddle;
    return null;
  }

  private promptData(
    reason: VoiceReason,
    amounts: Cents[],
    paddle: string | null,
    ctx: BidContext,
    text: string,
    pendingCents: Cents | undefined,
  ): PromptData {
    const a = amounts[0];
    const b = amounts[1];
    if (a === undefined) return { kind: 'low_confidence' };
    switch (reason) {
      case 'correction':
        if (paddle === null) break;
        return {
          kind: 'correction',
          paddle,
          amountCents: a,
          ...(pendingCents === undefined ? {} : { fromCents: pendingCents }),
        };
      case 'homophone':
        if (b === undefined) break;
        return { kind: 'homophone', text, amountACents: a, amountBCents: b };
      case 'unsupported_currency':
        return { kind: 'currency', amountCents: a };
      case 'large_jump':
        return {
          kind: 'large_jump',
          times: ctx.currentPriceCents > 0 ? Math.round((a / ctx.currentPriceCents) * 10) / 10 : 0,
          amountCents: a,
        };
      case 'fractional_amount':
        return { kind: 'fractional', amountCents: a, exact: formatUsd(a) };
      case 'unknown_bidder':
        return { kind: 'unknown_bidder', amountCents: a };
      case 'unregistered_paddle':
        if (paddle === null) break;
        return { kind: 'unregistered', paddle, amountCents: a };
      default:
        break;
    }
    if (paddle === null) {
      return (this.deps.mic ?? 'room') === 'device'
        ? { kind: 'device_mic', amountCents: a }
        : { kind: 'unknown_bidder', amountCents: a };
    }
    if (b !== undefined) return { kind: 'two_amounts', amountACents: a, amountBCents: b, paddle };
    return { kind: 'single', amountCents: a, paddle };
  }
}
