import type { Scenario, ScenarioStep } from '../../net/transport';
import type {
  BidderView,
  HoldView,
  RoomConfigView,
  RoomSnapshot,
  ServerMessage,
  SettlementState,
  SettlementView,
} from '../../wire';

export const ROOM_ID = 'room-demo';
export const LOT_ID = 'lot-1';
const BASE_TIME = 1_700_000_000_000;

export const baseConfig: RoomConfigView = {
  minIncrementCents: 5_000,
  reserveCents: 0,
  softCloseMs: 10_000,
  maxCeilingCents: 100_000,
  minCeilingCents: 5_000,
  lateEntry: true,
  mode: 'english',
};

export interface Envelope3 {
  seq: number;
  roomId: string;
  serverTime: number;
}

/** Builds a Scenario one message at a time. Sequence numbers count up from 1 in emit order. */
export class Script {
  readonly steps: ScenarioStep[] = [];
  private seq = 0;
  private bidSeq = 0;

  emit(at: number, build: (env: Envelope3) => ServerMessage, fault?: ScenarioStep['fault']): this {
    this.seq += 1;
    const msg = build({ seq: this.seq, roomId: ROOM_ID, serverTime: BASE_TIME + at });
    this.steps.push(fault === undefined ? { at, emit: msg } : { at, emit: msg, fault });
    return this;
  }

  /** Accepted bid: broadcast, acceptance for the bidder, and the new price. */
  acceptedBid(
    at: number,
    paddle: number,
    amountCents: number,
    bidCount: number,
    minIncrementCents: number = baseConfig.minIncrementCents,
    closesAt?: number,
  ): this {
    this.bidSeq += 1;
    const clientBidId = `cb-${this.bidSeq}`;
    this.emit(at, (e) => ({ t: 'bid', ...e, paddle, amountCents, clientBidId }));
    this.emit(at, (e) => ({ t: 'bid_accepted', ...e, clientBidId, paddle, amountCents }));
    return this.emit(at, (e) => ({
      t: 'price',
      ...e,
      currentCents: amountCents,
      leaderPaddle: paddle,
      nextMinCents: amountCents + minIncrementCents,
      bidCount,
      ...(closesAt === undefined ? {} : { closesAt }),
    }));
  }

  state(at: number, snapshot: RoomSnapshot): this {
    return this.emit(at, (e) => ({ t: 'state', ...e, ...snapshot }));
  }

  hammer(
    at: number,
    winnerPaddle: number | null,
    priceCents: number | null,
    reserveMet = true,
  ): this {
    return this.emit(at, (e) => ({
      t: 'hammer',
      ...e,
      lotId: LOT_ID,
      winnerPaddle,
      priceCents,
      reserveMet,
    }));
  }

  settlement(at: number, view: SettlementView): this {
    return this.emit(at, (e) => ({ t: 'settlement_update', ...e, settlement: view }));
  }

  build(name: string, description: string, roomConfig: RoomConfigView = baseConfig): Scenario {
    return { name, description, roomConfig, steps: this.steps };
  }
}

export function bidders(
  ...list: Array<[paddle: number, name: string, ceilingCents: number]>
): BidderView[] {
  return list.map(([paddle, name, ceilingCents]) => ({
    paddle,
    name,
    holdState: 'HELD',
    ceilingCents,
  }));
}

export function openSnapshot(
  list: BidderView[],
  config: RoomConfigView = baseConfig,
  status: RoomSnapshot['room']['status'] = 'OPEN',
): RoomSnapshot {
  return {
    room: { id: ROOM_ID, name: 'Spring Gala', status, config },
    lot: { id: LOT_ID, title: 'Signed first edition' },
    price: {
      currentCents: null,
      leaderPaddle: null,
      nextMinCents: config.minIncrementCents,
      bidCount: 0,
    },
    bidders: list,
  };
}

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
