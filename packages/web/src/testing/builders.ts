import {
  Cents,
  EpochMs,
  type AuctionConfig,
  type AuctionId,
  type BidderId,
  type BidId,
  type MsgId,
  type RoomSnapshot,
  type Ulid,
} from '@gavel/shared';
import type { PriceMsg, StateMsg } from '../wire';

/** Deterministic, valid ULIDs for fixtures: a kind digit followed by the number, zero padded. */
function idOf<B extends string>(kind: number, n: number): Ulid<B> {
  return `${kind}${String(n).padStart(25, '0')}` as Ulid<B>;
}

export const auctionId = (n = 1): AuctionId => idOf<'AuctionId'>(4, n);
export const bidderId = (paddle: number): BidderId => idOf<'BidderId'>(1, paddle);
export const msgId = (n: number): MsgId => idOf<'MsgId'>(2, n);
export const bidId = (n: number): BidId => idOf<'BidId'>(3, n);

export const BASE_TIME = 1_700_000_000_000;

export const baseConfig: AuctionConfig = {
  mode: 'english',
  currency: 'USD',
  reserve: Cents(100),
  minIncrement: Cents(5_000),
  endTs: EpochMs(BASE_TIME + 60_000),
  softCloseWindowMs: 10_000,
  softCloseExtensionMs: 10_000,
  maxExtensions: 6,
  ceilingPresets: [Cents(10_000), Cents(50_000)],
  confirmConfidenceThreshold: 0.7,
};

export type RosterEntry = RoomSnapshot['roster'][number];

export function roster(...list: Array<[paddle: number, name: string]>): RosterEntry[] {
  return list.map(([paddle, name]) => ({ bidderId: bidderId(paddle), paddle, name, hold: 'HELD' }));
}

export function openSnapshot(
  list: RosterEntry[],
  config: AuctionConfig = baseConfig,
  status: RoomSnapshot['status'] = 'OPEN',
  id: AuctionId = auctionId(),
): RoomSnapshot {
  return {
    auctionId: id,
    config,
    status,
    price: null,
    leaderId: null,
    endTs: config.endTs,
    minNext: config.minIncrement,
    roster: list,
    recentAudit: [],
  };
}

export function priceMsg(
  seq: number,
  paddle: number,
  cents: number,
  extra: { endTs?: number; extensions?: number } = {},
): PriceMsg {
  return {
    v: 1,
    t: 'price',
    seq,
    ts: EpochMs(BASE_TIME + seq),
    price: Cents(cents),
    leaderId: bidderId(paddle),
    leaderPaddle: paddle,
    endTs: EpochMs(extra.endTs ?? baseConfig.endTs),
    minNext: Cents(cents + baseConfig.minIncrement),
    extensions: extra.extensions ?? 0,
  };
}

export function stateMsg(
  seq: number,
  snapshot: RoomSnapshot = openSnapshot([]),
  ts: number = BASE_TIME + seq,
): StateMsg {
  return { v: 1, t: 'state', seq, ts: EpochMs(ts), snapshot };
}
