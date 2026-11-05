import { createHash } from 'node:crypto';
import {
  LIMITS,
  EngineError,
  decide,
  evolve,
  initialState,
  sealBatch,
  type AuctionState,
  type Command,
  type LedgerEntry,
  type LotConfig,
  type RejectReason,
  type Ulid as EngineUlid,
} from '@gavel/engine';
import {
  CROCKFORD,
  GavelError,
  type AuctionConfig,
  type AuctionId,
  type BidderId,
  type Cents,
  type EngineBidResult,
  type EngineState,
  type EngineView,
  type EpochMs,
  type ErrorCode,
} from '@gavel/shared';
import type {
  AbortEnginePort,
  ClockEnginePort,
  BidMeta,
  HammerResult,
  MetaBidEnginePort,
  RevokeEnginePort,
  RevokeReason,
} from '../room/settle-port';

/** One lot per room. Its id is the room's auction id, so a settlement key and a lot id coincide. */
export function lotIdOf(auctionId: AuctionId): string {
  return auctionId;
}

/** Shortest lot the engine accepts. */
const MIN_LOT_DURATION_MS = 1000;
const MAX_LOT_DURATION_MS = 86_400_000;
const MAX_SOFT_CLOSE_MS = 600_000;
const MAX_CEILING_CENTS = 100_000_000;

/**
 * Command id from the command's own content: a rebuilt room that applies the same
 * bid again produces the same id, so replaying the commands into the engine
 * runtime never writes an entry twice.
 */
export function commandIdFor(
  auctionId: string,
  parts: ReadonlyArray<string | number | boolean>,
): EngineUlid {
  const digest = createHash('sha256')
    .update(JSON.stringify([auctionId, ...parts]))
    .digest();
  let out = '';
  for (let i = 0; i < 26; i++) {
    const byte = digest[i] ?? 0;
    // The first character stays within 0..7, as a ULID's time prefix must.
    out += CROCKFORD.charAt(i === 0 ? byte & 7 : byte & 31);
  }
  return out as EngineUlid;
}

const CLOSED_ERRORS: ReadonlySet<string> = new Set(['lot_done', 'auction_closed', 'lot_not_open']);

const REJECT_TO_ERROR: Readonly<Record<RejectReason, ErrorCode>> = {
  lot_not_open: 'closed',
  unregistered: 'unregistered',
  ceiling_revoked: 'unregistered',
  bad_amount: 'bad_amount',
  unconfirmed: 'bad_message',
  over_ceiling: 'over_ceiling',
  below_reserve: 'below_reserve',
  below_increment: 'below_increment',
  already_leading: 'already_leading',
  not_higher_than_own_max: 'already_leading',
  already_bid: 'already_leading',
  limit_exceeded: 'room_cap',
};

/**
 * The room's engine, built on the engine's pure decide and evolve, so every call is
 * synchronous. It keeps the exact command list it applied; at the hammer the service
 * replays that list into the engine runtime, which owns the durable ledger the
 * settlement bridge talks to. A rebuilt room produces the same list again.
 */
export class LedgerEngine
  implements AbortEnginePort, RevokeEnginePort, MetaBidEnginePort, ClockEnginePort
{
  private state: AuctionState = initialState;
  private readonly lotId: EngineUlid;
  private readonly openAt: number;
  private readonly cfg: AuctionConfig;
  private applied: Command[] = [];
  /** Bids the engine accepted so far; it tells two bids of one millisecond apart. */
  private bidsApplied = 0;

  /**
   * `createdAt` is when the room was created: the ledger's auction, lot and opening are
   * stamped with it, so the ledger shows the real timeline. The lot runs from then to the
   * room's end time (at least the engine's shortest lot).
   */
  constructor(
    private readonly auctionId: AuctionId,
    cfg: AuctionConfig,
    createdAt: EpochMs = Math.max(0, cfg.endTs - MAX_LOT_DURATION_MS) as EpochMs,
  ) {
    this.cfg = cfg;
    this.lotId = lotIdOf(auctionId) as EngineUlid;
    this.openAt = Math.max(0, Math.min(createdAt, cfg.endTs - MIN_LOT_DURATION_MS));
    const durationMs = cfg.endTs - this.openAt;
    const lot: LotConfig = {
      lotId: this.lotId,
      title: 'Auction lot',
      mode: 'english',
      reserveCents: cfg.reserve,
      increment: { flatCents: cfg.minIncrement },
      durationMs,
      softClose: {
        windowMs: Math.min(cfg.softCloseWindowMs, MAX_SOFT_CLOSE_MS),
        extensionMs: Math.min(cfg.softCloseExtensionMs, MAX_SOFT_CLOSE_MS),
        maxExtensions: cfg.maxExtensions,
      },
      hammer: 'manual',
    };
    const at = this.openAt;
    this.run(at, 'CreateAuction', [], {
      type: 'CreateAuction',
      title: 'Gavel auction',
      config: {
        holdScope: 'event',
        maxCeilingCents: MAX_CEILING_CENTS,
        confirmBelowBps: Math.round(cfg.confirmConfidenceThreshold * 10_000),
        fallbackPolicy: 'runner_up',
        maxFallbackDepth: 2,
      },
    });
    this.run(at, 'AddLot', [], { type: 'AddLot', lot });
    this.run(at, 'OpenLot', [], { type: 'OpenLot', lotId: this.lotId });
  }

  get config(): AuctionConfig {
    return this.cfg;
  }

  /** The commands applied so far, in order, with the times they ran at. */
  get commands(): readonly Command[] {
    return this.applied;
  }

  /** True once the lot has been hammered (sold or unsold). */
  get hammered(): boolean {
    const status = this.lot()?.status;
    return status === 'SETTLING' || status === 'DONE';
  }

  register(bidder: BidderId, ceiling: Cents): void {
    this.run(this.state.head.at, 'RegisterBidder', [bidder, ceiling], {
      type: 'RegisterBidder',
      bidderId: bidder as unknown as EngineUlid,
      ceilingCents: ceiling,
    });
  }

  placeBid(bidder: BidderId, amount: Cents, ts: EpochMs): EngineBidResult {
    return this.placeBidWith(bidder, amount, ts, { source: 'manual' });
  }

  placeBidWith(bidder: BidderId, amount: Cents, ts: EpochMs, meta: BidMeta): EngineBidResult {
    const at = Math.max(ts, this.state.head.at);
    let outcome: ReturnType<typeof decide>['outcome'];
    try {
      outcome = this.run(
        at,
        'PlaceBid',
        [bidder, amount, this.bidsApplied],
        {
          type: 'PlaceBid',
          lotId: this.lotId,
          bidderId: bidder as unknown as EngineUlid,
          amountCents: amount,
          source: meta.source,
          audit: auditOf(meta),
        },
        false,
      ).outcome;
    } catch (e) {
      if (e instanceof EngineError && CLOSED_ERRORS.has(e.code))
        return { ok: false, code: 'closed' };
      throw e;
    }
    // The command id carries the count of accepted bids, so two bids of one millisecond are
    // never taken for one; a duplicate here can only be a repeat of a bid already counted.
    const result = outcome.kind === 'duplicate' ? outcome.original : outcome;
    if (result.kind === 'rejected') return { ok: false, code: REJECT_TO_ERROR[result.reason] };
    this.bidsApplied += 1;
    return { ok: true };
  }

  tick(now: EpochMs): EngineState {
    const at = Math.max(now, this.state.head.at);
    this.run(at, 'Tick', [], { type: 'Tick' });
    return this.engineState();
  }

  hammer(now: EpochMs): HammerResult {
    const at = Math.max(now, this.state.head.at);
    const early = this.lot()?.status === 'OPEN';
    const entries = this.run(at, 'Hammer', [early], {
      type: 'Hammer',
      lotId: this.lotId,
      early,
      actor: 'auctioneer',
    }).entries;
    const hammered = entries.find((e) => e.type === 'LOT_HAMMERED');
    if (hammered === undefined || hammered.type !== 'LOT_HAMMERED') {
      return { winnerId: null, price: 0 as Cents, ranking: [] };
    }
    const p = hammered.payload;
    return {
      winnerId: p.winnerId as unknown as BidderId,
      price: p.priceCents as Cents,
      ranking: p.ranking.map((r) => ({
        bidderId: r.bidderId as unknown as BidderId,
        amount: r.amountCents as Cents,
      })),
    };
  }

  /**
   * Cancels the lot before the hammer (the kill switch). The engine lot ends DONE with
   * no winner; the room treats it as an unsold hammer and the settlement voids every hold.
   */
  abort(now: EpochMs): HammerResult {
    const at = Math.max(now, this.state.head.at);
    this.run(at, 'AbortLot', [], {
      type: 'AbortLot',
      lotId: this.lotId,
      reason: 'kill_switch',
      actor: 'kill_switch',
    });
    return { winnerId: null, price: 0 as Cents, ranking: [] };
  }

  /** True while the lot clock is frozen by a pause. */
  get paused(): boolean {
    return this.lot()?.pausedRemainingMs !== undefined;
  }

  /** Freezes the lot clock; throws a `conflict` GavelError when the engine refuses. */
  pause(now: EpochMs): void {
    this.clock(now, 'PauseLot', [], { type: 'PauseLot', lotId: this.lotId, actor: 'auctioneer' });
  }

  /** Restarts a paused clock with the time that was left. */
  resume(now: EpochMs): void {
    this.clock(now, 'ResumeLot', [], { type: 'ResumeLot', lotId: this.lotId, actor: 'auctioneer' });
  }

  /** Adds `extraMs` to a running lot. */
  extend(now: EpochMs, extraMs: number): void {
    this.clock(now, 'ExtendLot', [extraMs], {
      type: 'ExtendLot',
      lotId: this.lotId,
      extraMs,
      reason: 'auctioneer',
      actor: 'auctioneer',
    });
  }

  private clock(
    now: EpochMs,
    kind: string,
    key: ReadonlyArray<string | number | boolean>,
    body: DistributiveOmit<Command, 'commandId' | 'at' | 'auctionId'>,
  ): void {
    const at = Math.max(now, this.state.head.at);
    try {
      // A command the engine rejects leaves no ledger entry; the caller must not log it as applied.
      if (this.run(at, kind, key, body).entries.length === 0) {
        throw new GavelError('conflict', kind);
      }
    } catch (e) {
      if (e instanceof EngineError) throw new GavelError('conflict', e.code);
      throw e;
    }
  }

  /** Revokes the bidder's ceiling and strikes their bids; false when already revoked. */
  revoke(bidder: BidderId, reason: RevokeReason, now: EpochMs): boolean {
    const at = Math.max(now, this.state.head.at);
    return (
      this.run(at, 'RevokeCeiling', [bidder, reason], {
        type: 'RevokeCeiling',
        bidderId: bidder as unknown as EngineUlid,
        reason,
      }).entries.length > 0
    );
  }

  view(): EngineView {
    const lot = this.lot();
    const leader = lot?.leaderId ?? null;
    const best = leader === null ? undefined : lot?.best[leader];
    const price = best?.amountCents ?? null;
    return {
      state: this.engineState(),
      price: price === null ? null : (price as Cents),
      leader: leader as unknown as BidderId | null,
      endTs: (lot?.endsAt ?? this.cfg.endTs) as EpochMs,
      extensions: lot?.extensions ?? 0,
      minNext: (price === null ? this.cfg.reserve : price + this.cfg.minIncrement) as Cents,
    };
  }

  private lot(): AuctionState['lots'][string] | undefined {
    return this.state.lots[this.lotId];
  }

  private engineState(): EngineState {
    switch (this.lot()?.status) {
      case 'CLOSING':
        return 'CLOSING';
      case 'SETTLING':
        return 'SETTLING';
      case 'DONE':
        return 'DONE';
      default:
        return 'OPEN';
    }
  }

  /**
   * Decides, seals and applies one command. A command the engine refuses by throwing
   * leaves the state and the command list as they were. With `commitRejected` false a
   * rejection is reported but not applied.
   */
  private run(
    at: number,
    kind: string,
    key: ReadonlyArray<string | number | boolean>,
    body: DistributiveOmit<Command, 'commandId' | 'at' | 'auctionId'>,
    commitRejected = true,
  ): { outcome: ReturnType<typeof decide>['outcome']; entries: LedgerEntry[] } {
    const cmd = {
      ...body,
      commandId: commandIdFor(this.auctionId, [kind, at, ...key]),
      at,
      auctionId: this.auctionId as unknown as EngineUlid,
    } as Command;
    const result = decide(this.state, cmd);
    if (result.events.length === 0) return { outcome: result.outcome, entries: [] };
    // The room's log holds no replay step for a rejected bid, so a rebuilt room could not
    // reproduce its entries; keeping them out keeps both lives identical.
    if (!commitRejected && result.outcome.kind === 'rejected') {
      return { outcome: result.outcome, entries: [] };
    }
    const entries = sealBatch(
      result.events,
      { auctionId: cmd.auctionId, seq: this.state.head.seq, hash: this.state.head.hash },
      cmd.at,
      cmd.commandId,
    );
    this.state = entries.reduce(evolve, this.state);
    this.applied.push(cmd);
    return { outcome: result.outcome, entries };
  }
}

/**
 * The audit fields the engine keeps. Only a voice bid carries a confidence, and a bid the
 * bidder confirmed carries that answer; otherwise it is left unconfirmed and the engine gate decides (R-RT-045).
 * Manual and QR bids are entered by a person and are not scored.
 */
function auditOf(meta: BidMeta): Extract<Command, { type: 'PlaceBid' }>['audit'] {
  // A voice bid with no confidence is still scored: it is never stamped confirmed by absence.
  const scored = meta.source === 'voice';
  const audit: Extract<Command, { type: 'PlaceBid' }>['audit'] =
    scored && meta.confirmed !== true ? {} : { confirmed: true };
  if (meta.transcript !== undefined) audit.transcript = meta.transcript.slice(0, LIMITS.transcript);
  if (scored && meta.confidence !== undefined) {
    audit.confidenceBps = Math.round(meta.confidence * 10_000);
  }
  return audit;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
