import { Cents, EpochMs, type AuctionConfig, type RoomSnapshot } from '@gavel/shared';
import type { HoldView, SettlementView } from '../../ladder/ladderModel';
import type { Scenario, ScenarioStep } from '../../net/transport';
import type { ServerMessage, SettlementState } from '../../wire';
import {
  BASE_TIME,
  baseConfig,
  bidId,
  bidderId,
  msgId,
  openSnapshot,
  roster,
  type RosterEntry,
} from '../builders';

export { baseConfig, openSnapshot, roster };

export const LOT_ID = 'lot-1';

export interface Envelope3 {
  seq: number;
  ts: EpochMs;
}

/** Builds a Scenario one message at a time. Sequence numbers count up from 1 in emit order. */
export class Script {
  readonly steps: ScenarioStep[] = [];
  private readonly views: SettlementView[] = [];
  private seq = 0;
  private bidSeq = 0;
  private rev = 0;

  emit(at: number, build: (env: Envelope3) => ServerMessage, fault?: ScenarioStep['fault']): this {
    this.seq += 1;
    const msg = build({ seq: this.seq, ts: EpochMs(BASE_TIME + at) });
    this.steps.push(fault === undefined ? { at, emit: msg } : { at, emit: msg, fault });
    return this;
  }

  /** Accepted bid: the acceptance for the bidder, then the new price for everyone. */
  acceptedBid(
    at: number,
    paddle: number,
    amountCents: number,
    minIncrementCents: number = baseConfig.minIncrement,
    endTs?: number,
    extensions = 0,
  ): this {
    this.bidSeq += 1;
    const n = this.bidSeq;
    this.emit(at, (e) => ({
      v: 1,
      t: 'bid_accepted',
      ...e,
      mid: msgId(n),
      bidId: bidId(n),
      amount: Cents(amountCents),
    }));
    return this.emit(at, (e) => ({
      v: 1,
      t: 'price',
      ...e,
      price: Cents(amountCents),
      leaderId: bidderId(paddle),
      leaderPaddle: paddle,
      endTs: EpochMs(endTs ?? baseConfig.endTs),
      minNext: Cents(amountCents + minIncrementCents),
      extensions,
    }));
  }

  state(at: number, snapshot: RoomSnapshot): this {
    return this.emit(at, (e) => ({ v: 1, t: 'state', ...e, snapshot }));
  }

  hammer(at: number, winnerPaddle: number | null, priceCents: number): this {
    return this.emit(at, (e) => ({
      v: 1,
      t: 'hammer',
      ...e,
      winnerId: winnerPaddle === null ? null : bidderId(winnerPaddle),
      price: Cents(priceCents),
      ranking:
        winnerPaddle === null
          ? []
          : [{ bidderId: bidderId(winnerPaddle), amount: Cents(priceCents) }],
    }));
  }

  /** Emits the phase on the wire and keeps the per-hold detail for the ladder. */
  settlement(at: number, view: SettlementView): this {
    this.views.push(view);
    this.rev += 1;
    const rev = this.rev;
    const captured = view.holds.reduce((n, h) => n + h.capturedCents, 0);
    return this.emit(at, (e) => ({
      v: 1,
      t: 'settlement_update',
      ...e,
      rev,
      auctionState: view.phase,
      ...(captured > 0 ? { amountCaptured: Cents(captured) } : {}),
    }));
  }

  build(name: string, description: string, roomConfig: AuctionConfig = baseConfig): Scenario {
    return { name, description, roomConfig, steps: this.steps, settlementViews: this.views };
  }
}

/** Roster rows for a scenario: `[paddle, name]`. */
export const bidders = roster;
export type { RosterEntry };

export function hold(
  paddle: number,
  name: string,
  ceilingCents: number,
  state: SettlementState,
  capturedCents = 0,
  releasedCents = 0,
  extra: Partial<HoldView> = {},
): HoldView {
  return {
    paddle,
    name,
    ceilingCents,
    state,
    capturedCents,
    releasedCents,
    verifiedBy: [],
    idSuffix: `AB${String(paddle).padStart(4, '0')}`,
    ...extra,
  };
}

export function settlementView(
  phase: SettlementState,
  winnerPaddle: number | null,
  holds: HoldView[],
  ok = true,
  violations: string[] = [],
): SettlementView {
  return { lotId: LOT_ID, phase, winnerPaddle, holds, invariants: { ok, violations } };
}
