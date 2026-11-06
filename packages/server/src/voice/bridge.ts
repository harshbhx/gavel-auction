import {
  budgetCheck,
  buildAudit,
  commandIdFromKey,
  toPlaceBid,
  VoicePipeline,
  type BudgetReport,
  type LatencySample,
  type PipelineOutput,
} from '@gavel/voice';
import type { AudioBatch, BidContext, Decision, SttProvider } from '@gavel/voice';
import {
  MAX_TRANSCRIPT_CHARS,
  type AuctionId,
  type BidMsg,
  type BidderId,
  type Clock,
  type MsgId,
} from '@gavel/shared';
import type { VoiceView } from '../room/room';

/** The room side the bridge needs; `Room` satisfies it. */
export interface VoiceRoomPort {
  voiceView(): VoiceView | undefined;
  submitVoiceBid(bidderId: BidderId, msg: BidMsg): Promise<void>;
}

export interface VoiceBridgeDeps {
  auctionId: AuctionId;
  room: VoiceRoomPort;
  stt: SttProvider;
  clock: Clock;
  /** Period of the pipeline housekeeping tick. Default 250 ms. */
  tickMs?: number;
  log?: (message: string, fields?: Record<string, string>) => void;
}

export interface VoiceBridge {
  /** Hand one decoded audio batch to the speech provider. */
  write(batch: AudioBatch): void;
  /** Stop the provider and the tick. Safe to call twice. */
  close(): Promise<void>;
  /** Speech end to decision latency against the R-VOX-101 budget, over the decisions so far. */
  latency(): BudgetReport;
  /** Resolves when the provider has ended and every pending bid was handed to the room. */
  readonly done: Promise<void>;
}

/** The ceiling the pipeline sees: the room keeps real ceilings private and the engine enforces them. */
const OPEN_CEILING = Number.MAX_SAFE_INTEGER;

function contextOf(view: VoiceView | undefined, nowMs: number): BidContext {
  const roster = new Map<string, { bidderId: string; ceilingCents: number; holdActive: boolean }>();
  for (const r of view?.roster ?? []) {
    roster.set(r.paddle, { bidderId: r.bidderId, ceilingCents: OPEN_CEILING, holdActive: true });
  }
  return {
    nowMs,
    lotState: view?.open === true ? 'OPEN' : 'OTHER',
    currentPriceCents: view?.price ?? 0,
    minIncrementCents: view?.minIncrement ?? 1,
    highBidderId: view?.leader ?? null,
    roster,
    recent: [],
  };
}

/** The one bidder a confirm decision is about, or null when it is genuinely ambiguous. */
function confirmTarget(d: Extract<Decision, { kind: 'confirm' }>): {
  bidderId: string;
  amountCents: number;
} | null {
  const first = d.prompt.options[0];
  if (first === undefined) return null;
  const target = d.prompt.targetBidderId ?? first.bidderId;
  const option = d.prompt.options.find((o) => o.bidderId === target);
  return option === undefined
    ? null
    : { bidderId: option.bidderId, amountCents: option.amountCents };
}

/**
 * Runs the voice pipeline for one audio stream of one room and hands what it decides to the room.
 * An accepted decision becomes a voice bid with its confidence; a confirm decision becomes a voice
 * bid flagged ambiguous. Either way the room's own gate applies: below its confidence threshold or
 * flagged, the bid is held and its bidder is asked, and the engine judges every bid that passes.
 */
export function startVoiceBridge(deps: VoiceBridgeDeps): VoiceBridge {
  const { auctionId, room, stt, clock } = deps;
  const startedAt = clock.now();
  const elapsed = (): number => clock.now() - startedAt;
  let n = 0;
  const pipeline = new VoicePipeline({
    roomId: auctionId,
    lotId: auctionId,
    clock: elapsed,
    ids: () => `seg-${(n += 1)}`,
    context: () => contextOf(room.voiceView(), elapsed()),
    sttProvider: stt.name,
    replay: stt.name === 'replay',
    mic: 'room',
  });

  let pending: Promise<void> = Promise.resolve();
  let closed = false;
  const samples: LatencySample[] = [];

  /**
   * Every decision gets its audit record (R-VOX-071) and a latency sample (R-VOX-101). The log
   * line carries the outcome and reason only, never the transcript.
   */
  const record = (decision: Decision): void => {
    samples.push({ speechEndMs: decision.evidence.audioEndMs, decisionMs: elapsed() });
    try {
      const audit = buildAudit(decision);
      deps.log?.('voice decision', { outcome: audit.outcome, reason: audit.reason });
    } catch (e) {
      deps.log?.('voice audit failed', { error: e instanceof Error ? e.message : String(e) });
    }
  };

  const toBid = (decision: Decision): { bidderId: string; msg: BidMsg } | null => {
    const view = room.voiceView();
    if (decision.kind === 'accept') {
      const cmd = toPlaceBid(decision, {
        auctionId,
        lotId: auctionId,
        at: clock.now(),
        promptNowMs: elapsed(),
      });
      if (cmd === null) return null;
      return {
        bidderId: cmd.bidderId,
        msg: {
          v: 1,
          t: 'bid',
          mid: cmd.commandId as MsgId,
          amount: cmd.amountCents,
          source: 'voice',
          transcript: cmd.audit.transcript.slice(0, MAX_TRANSCRIPT_CHARS),
          confidence: cmd.audit.confidenceBps / 10_000,
          audioTsMs: Math.max(0, Math.trunc(cmd.audit.audioStartMs)),
        },
      };
    }
    if (decision.kind === 'confirm') {
      const target = confirmTarget(decision);
      if (target === null || view === undefined) return null;
      const ev = decision.evidence;
      return {
        bidderId: target.bidderId,
        msg: {
          v: 1,
          t: 'bid',
          mid: commandIdFromKey(auctionId, `confirm|${ev.idempotencyKey}`) as MsgId,
          amount: target.amountCents,
          source: 'voice',
          transcript: ev.transcript.slice(0, MAX_TRANSCRIPT_CHARS),
          confidence: Math.min(Math.max(ev.confidence, 0), 1),
          ambiguous: true,
          audioTsMs: Math.max(0, Math.trunc(ev.audioStartMs)),
        },
      };
    }
    return null;
  };

  const handle = (outputs: PipelineOutput[]): void => {
    for (const out of outputs) {
      if (out.type !== 'decision') continue;
      record(out.decision);
      const bid = toBid(out.decision);
      if (bid === null) continue;
      pending = pending
        .then(() => room.submitVoiceBid(bid.bidderId as BidderId, bid.msg))
        .catch((e: unknown) => {
          deps.log?.('voice bid failed', { error: e instanceof Error ? e.message : String(e) });
        });
    }
  };

  const tickMs = deps.tickMs ?? 250;
  let cancelTick: (() => void) | undefined;
  const arm = (): void => {
    cancelTick = clock.setTimer(clock.now() + tickMs, () => {
      if (closed) return;
      handle(pipeline.tick());
      arm();
    });
  };

  const done = (async (): Promise<void> => {
    try {
      await stt.start({ keyterms: [], language: 'en' });
      arm();
      for await (const ev of stt.events()) {
        if (closed) break;
        handle(pipeline.push(ev));
      }
    } catch (e) {
      deps.log?.('voice stream failed', { error: e instanceof Error ? e.message : String(e) });
    } finally {
      closed = true;
      cancelTick?.();
      await pending;
    }
  })();

  return {
    done,
    latency: () => budgetCheck(samples, 'rules_only'),
    write: (batch) => {
      if (!closed) stt.write(batch);
    },
    close: async () => {
      if (closed) return done;
      closed = true;
      cancelTick?.();
      await stt.stop().catch(() => undefined);
      await done;
    },
  };
}
