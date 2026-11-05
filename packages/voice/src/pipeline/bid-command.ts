import { answerConfirm } from '../decide/answer.js';
import type { AuditRecord, BidContext, Decision } from '../types.js';

/** Crockford base32, the alphabet of a ULID. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const MAX_BPS = 10_000;

/** Context the room supplies when it turns a decision into an engine command. */
export interface PlaceBidContext {
  auctionId: string;
  lotId: string;
  /** Room clock reading at delivery, epoch ms. */
  at: number;
  /** Bidder and amount for a `confirm` decision once the bidder picked an option. */
  confirmedOptionId?: string;
  /** Who answered the confirm prompt; recorded in the audit (R-VOX-069). Default 'bidder'. */
  confirmedBy?: ConfirmedBy;
  /**
   * Fresh bid context at delivery. When given, a confirmed option is re-validated against it
   * (price moved, ceiling, already high bidder, duplicate window) and a failing option gives null.
   */
  current?: BidContext;
  /** Confidence an `accept` needs to become a bid without a prompt, 0..1. Default 0.85. */
  autoThreshold?: number;
}

export type ConfirmedBy = 'bidder' | 'auctioneer' | 'voice';

/** Confidence at or above which a decision is auto-accepted (R-VOX-063). */
export const AUTO_CONFIDENCE = 0.85;

/** The engine PlaceBid fields this package produces; structurally the engine command. */
export interface PlaceBidCommand {
  type: 'PlaceBid';
  commandId: string;
  at: number;
  auctionId: string;
  lotId: string;
  bidderId: string;
  amountCents: number;
  source: 'voice';
  audit: {
    transcript: string;
    audioStartMs: number;
    audioEndMs: number;
    confidenceBps: number;
    confirmed: boolean;
    confirmedBy?: ConfirmedBy;
  };
}

/** Confidence 0..1 (or a threshold) to integer basis points 0..10000; NaN maps to 0. */
export function confidenceToBps(fraction: number): number {
  if (Number.isNaN(fraction)) return 0;
  return Math.min(MAX_BPS, Math.max(0, Math.round(fraction * MAX_BPS)));
}

function fnv1a(text: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Width of the audio-start bucket that identifies one utterance in a command id (R9-V05). */
const ID_WINDOW_MS = 5000;

/**
 * True when the engine refused a voice command only because the same id arrived with different
 * evidence (another provider's transcript of the same speech). The caller treats it as a
 * duplicate, not a failure (R9-V05).
 */
export function isReplayConflict(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === 'command_conflict'
  );
}

/**
 * A ULID-shaped command id derived from the given key. Speech the STT replays after a reconnect
 * or a provider switch carries the same stable key, so it maps to the same id and the engine's
 * commandId dedupe drops it (R-VOX-071, R-RT-053).
 */
export function commandIdFromKey(auctionId: string, idempotencyKey: string): string {
  const text = `${auctionId}|${idempotencyKey}`;
  const seeds = [0x811c9dc5, 0x01000193, 0x9e3779b1, 0x85ebca6b];
  const bits: string[] = [];
  for (const seed of seeds) bits.push(fnv1a(text, seed).toString(2).padStart(32, '0'));
  const stream = bits.join('');
  let out = '';
  for (let i = 0; i < 26; i++) {
    const chunk = stream.slice(i * 5, i * 5 + 5).padEnd(5, '0');
    // A ULID's first character stays within 0..7.
    const value = i === 0 ? parseInt(chunk, 2) & 7 : parseInt(chunk, 2);
    out += CROCKFORD.charAt(value);
  }
  return out;
}

/**
 * Map a decision to an engine PlaceBid. Pure. Only an `accept`, or a `confirm`
 * the bidder resolved through {@link resolveConfirm}, becomes a bid; `drop` and
 * an unresolved `confirm` give null. The source is always 'voice' and the
 * confidence always present, so the engine gate cannot be skipped.
 */
export function toPlaceBid(decision: Decision, ctx: PlaceBidContext): PlaceBidCommand | null {
  let bidderId: string;
  let amountCents: number;
  let confirmed = false;
  let confirmedBy: ConfirmedBy | undefined;
  if (decision.kind === 'accept') {
    // Below the auto threshold a bid needs a confirm prompt, never a direct bid (R-VOX-063).
    const threshold = ctx.autoThreshold ?? AUTO_CONFIDENCE;
    if (!(decision.confidence >= threshold && decision.evidence.confidence >= threshold)) {
      return null;
    }
    bidderId = decision.bidderId;
    amountCents = decision.amountCents;
  } else if (decision.kind === 'confirm' && ctx.confirmedOptionId !== undefined) {
    // An answer after the prompt expired is dropped (R-VOX-067).
    if (ctx.at >= decision.prompt.expiresAtMs) return null;
    const option = decision.prompt.options.find((o) => o.id === ctx.confirmedOptionId);
    if (option === undefined) return null;
    // A prompt that forbids spoken answers cannot be confirmed by voice (R8-V10).
    if (ctx.confirmedBy === 'voice' && !decision.prompt.spokenAnswerAllowed) return null;
    bidderId = option.bidderId;
    amountCents = option.amountCents;
    if (ctx.current !== undefined) {
      const outcome = answerConfirm({
        prompt: decision.prompt,
        ctx: ctx.current,
        optionId: option.id,
        by: ctx.confirmedBy ?? 'bidder',
      });
      if (outcome.kind !== 'bid') return null;
      bidderId = outcome.bidderId;
      amountCents = outcome.amountCents;
    }
    confirmed = true;
    confirmedBy = ctx.confirmedBy ?? 'bidder';
  } else {
    return null;
  }
  const ev = decision.evidence;
  const confidenceBps = confidenceToBps(ev.confidence);
  // The id is the idempotency token, so it covers the stable identity of the utterance only:
  // lot, bidder, amount, confirmed option and the audio window. Transcript and confidence vary
  // between providers replaying the same speech and stay in the body (R9-V05). The window is
  // bucketed so a replay whose start differs by a few ms still maps to the same id.
  const bodyKey = [
    ctx.lotId,
    bidderId,
    amountCents,
    confirmed ? `c:${ctx.confirmedOptionId ?? ''}:${confirmedBy ?? ''}` : 'a',
    Math.floor(ev.audioStartMs / ID_WINDOW_MS),
  ].join('|');
  return {
    type: 'PlaceBid',
    commandId: commandIdFromKey(ctx.auctionId, bodyKey),
    at: ctx.at,
    auctionId: ctx.auctionId,
    lotId: ctx.lotId,
    bidderId,
    amountCents,
    source: 'voice',
    audit: {
      transcript: ev.transcript,
      audioStartMs: ev.audioStartMs,
      audioEndMs: ev.audioEndMs,
      confidenceBps,
      confirmed,
      ...(confirmedBy !== undefined ? { confirmedBy } : {}),
    },
  };
}

/**
 * The audit record after the bidder answered a confirm prompt. Accepting marks
 * it confirmed and accepted; declining or an unknown option rejects it.
 */
export function resolveConfirm(
  decision: Decision,
  answer: { optionId: string } | { accept: false },
  at: number,
): AuditRecord | null {
  if (decision.kind !== 'confirm') return null;
  // An answer after the prompt expired confirms nothing (R-VOX-067).
  if (at >= decision.prompt.expiresAtMs) return null;
  const ev = decision.evidence;
  const option =
    'optionId' in answer
      ? decision.prompt.options.find((o) => o.id === answer.optionId)
      : undefined;
  if (option === undefined) {
    return {
      decision: 'confirm',
      outcome: 'rejected',
      transcript: ev.transcript,
      bidderId: null,
      amountCents: null,
      confidence: ev.confidence,
      confirmed: false,
      reason: ev.reason,
      evidence: ev,
    };
  }
  return {
    decision: 'confirm',
    outcome: 'accepted',
    transcript: ev.transcript,
    bidderId: option.bidderId,
    amountCents: option.amountCents,
    confidence: ev.confidence,
    confirmed: true,
    reason: ev.reason,
    evidence: ev,
  };
}
