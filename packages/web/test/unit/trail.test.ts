import { Cents, EpochMs } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import {
  applyTrailFilters,
  EMPTY_FILTERS,
  parseFilters,
  filtersToSearch,
} from '../../src/screens/audit/filters';
import { buildTrail, summarize } from '../../src/screens/audit/trail';
import { describeEntry, entryTime } from '../../src/screens/audit/trailText';
import { initialRoomState, type RoomState } from '../../src/store/roomReducer';
import {
  BASE_TIME,
  auctionId,
  baseConfig,
  bidId,
  bidderId,
  openSnapshot,
  roster,
} from '../../src/testing/builders';
import type { AuditPayload } from '../../src/wire';

const names = { nameOf: (p: number): string | null => (p === 1 ? 'Ana' : p === 2 ? 'Ben' : null) };

function row(
  seq: number,
  paddle: number,
  outcome: AuditPayload['outcome'],
  cents?: number,
): AuditPayload {
  return {
    bidId: bidId(seq),
    bidderId: bidderId(paddle),
    source: 'voice',
    outcome,
    serverTs: EpochMs(BASE_TIME + seq * 1000),
    seq,
    ...(cents === undefined ? {} : { parsedAmount: Cents(cents) }),
  } as AuditPayload;
}

function room(extra: Partial<RoomState> = {}): RoomState {
  return {
    ...initialRoomState(auctionId()),
    snapshot: { ...openSnapshot(roster([1, 'Ana'], [2, 'Ben'])), lotTitle: 'Signed poster' },
    audit: [row(1, 1, 'accepted', 5000), row(2, 2, 'accepted', 10000), row(3, 1, 'rejected', 9000)],
    ...extra,
  };
}

function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('missing');
  return v;
}

describe('buildTrail', () => {
  it('lists holds, bids, the outbid they caused and rejected attempts in order', () => {
    const kinds = buildTrail(room()).map((e) => e.kind);
    expect(kinds).toEqual(['hold', 'hold', 'bid', 'bid', 'outbid', 'rejected']);
  });

  it('writes plain sentences', () => {
    const lines = buildTrail(room()).map((e) => describeEntry(e, names));
    expect(lines).toContain('Paddle 1, Ana has a hold in place. Held, not charged.');
    expect(lines).toContain('Paddle 2, Ben bid $100.00 by voice.');
    expect(lines).toContain('Paddle 1, Ana was outbid by Paddle 2, Ben. The price is now $100.00.');
    expect(lines).toContain('The bid of $90.00 from Paddle 1, Ana was not accepted.');
  });

  it('adds hammer, settlement and receipt lines once the lot is hammered', () => {
    const state = room({
      hammer: {
        v: 1,
        t: 'hammer',
        seq: 9,
        ts: EpochMs(BASE_TIME + 9000),
        winnerId: bidderId(2),
        price: Cents(10000),
        ranking: [],
      } as never,
      settlementLadderCounts: { CAPTURED: 1, SETTLED: 1 },
    });
    const trail = buildTrail(state);
    expect(trail.map((e) => e.kind).slice(-4)).toEqual([
      'hammer',
      'settlement',
      'settlement',
      'receipt',
    ]);
    expect(describeEntry(must(trail.at(-4)), names)).toBe(
      'Paddle 2, Ben won at $100.00. The hammer fell.',
    );
    const s = summarize(state);
    expect(s).toMatchObject({
      status: 'sold',
      priceCents: 10000,
      sold: true,
      charged: 1,
      released: 1,
    });
  });

  it('shows a soft close extension only when the closing time moved', () => {
    expect(buildTrail(room()).some((e) => e.kind === 'extend')).toBe(false);
    const snap = {
      ...openSnapshot(roster([1, 'Ana'])),
      endTs: EpochMs(Number(baseConfig.endTs) + 20_000),
    };
    const extend = buildTrail(room({ snapshot: snap })).find((e) => e.kind === 'extend');
    expect(extend).toMatchObject({ count: 2 });
    expect(describeEntry(must(extend), names)).toContain('Extensions so far: 2');
  });

  it('marks a paused room', () => {
    const snap = { ...openSnapshot(roster([1, 'Ana'])), paused: true };
    expect(buildTrail(room({ snapshot: snap })).some((e) => e.kind === 'pause')).toBe(true);
    expect(summarize(room({ snapshot: snap })).status).toBe('paused');
  });

  it('gives lines with no recorded time words instead of a clock', () => {
    const [hold] = buildTrail(room());
    expect(entryTime(must(hold))).toBe('Before bidding');
  });
});

describe('summarize', () => {
  it('counts bidders, bids and holds without a settlement', () => {
    expect(summarize(room())).toMatchObject({
      lotTitle: 'Signed poster',
      bidders: 2,
      acceptedBids: 2,
      attempts: 3,
      held: 2,
      released: 0,
      charged: 0,
      status: 'open',
    });
  });
});

describe('trail filters', () => {
  const trail = buildTrail(room());
  const latest = BASE_TIME + 3000;
  it('keeps one type', () => {
    const f = parseFilters('type=outbid');
    expect(applyTrailFilters(trail, f, latest).map((e) => e.kind)).toEqual(['outbid']);
  });
  it('filters by bidder, including the bidder who was outbid', () => {
    const f = parseFilters('paddle=2');
    expect(applyTrailFilters(trail, f, latest).map((e) => e.kind)).toEqual([
      'hold',
      'bid',
      'outbid',
    ]);
  });
  it('drops untimed lines when a time window is set', () => {
    const f = parseFilters('since=1');
    const kinds = applyTrailFilters(trail, f, latest).map((e) => e.kind);
    expect(kinds).not.toContain('hold');
    expect(kinds).toContain('rejected');
  });
  it('round-trips the new query parameters and ignores bad ones', () => {
    expect(filtersToSearch(parseFilters('type=bid&since=5'))).toBe('type=bid&since=5');
    expect(filtersToSearch(parseFilters('type=zzz&since=7'))).toBe('');
    expect(filtersToSearch(EMPTY_FILTERS)).toBe('');
  });
});
