import { Cents, EpochMs } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { buildLadder } from '../../src/ladder/ladderModel';
import { initialRoomState, reduce, type RoomState } from '../../src/store/roomReducer';
import { selectCeilingUsage, selectMyStatus } from '../../src/store/selectors';
import {
  BASE_TIME,
  bidId,
  bidderId,
  msgId,
  openSnapshot,
  priceMsg,
  roster,
  stateMsg,
} from '../../src/testing/builders';
import { hold, settlementView } from '../../src/testing/scenarios/_kit';
import type { ServerMessage } from '../../src/wire';

const ME = 5;
const you = { bidderId: bidderId(ME), ceiling: Cents(50_000) };

function run(state: RoomState, ...msgs: ServerMessage[]) {
  let current = state;
  const effects: unknown[] = [];
  for (const msg of msgs) {
    const r = reduce(current, { kind: 'wire', msg });
    current = r.state;
    effects.push(...r.effects);
  }
  return { state: current, effects };
}

const audit = (seq: number, paddle: number, cents: number): ServerMessage => ({
  v: 1,
  t: 'audit_event',
  seq,
  ts: EpochMs(BASE_TIME + seq),
  audit: {
    bidId: bidId(seq),
    bidderId: bidderId(paddle),
    source: 'qr',
    outcome: 'accepted',
    serverTs: EpochMs(BASE_TIME + seq),
    parsedAmount: Cents(cents),
    seq,
  },
});

const accepted = (seq: number): ServerMessage => ({
  v: 1,
  t: 'bid_accepted',
  seq,
  ts: EpochMs(BASE_TIME + seq),
  mid: msgId(seq),
  bidId: bidId(seq),
  amount: Cents(5_000),
});

function base(): RoomState {
  const snap = { ...openSnapshot(roster([ME, 'Me'], [9, 'Other'])), you };
  return run(initialRoomState(snap.auctionId), stateMsg(6, snap)).state;
}

describe('same-seq frames (WEB-R2-01, R-RT-036)', () => {
  it('applies bid_accepted, price and audit_event that share one seq', () => {
    const r = run(base(), accepted(7), priceMsg(7, ME, 5_000), audit(7, ME, 5_000));
    expect(r.state.lastSeq).toBe(7);
    expect(r.effects).toEqual([]);
    expect(r.state.snapshot?.price).toBe(5_000);
    expect(r.state.snapshot?.leaderId).toBe(bidderId(ME));
    expect(r.state.audit).toHaveLength(1);
    expect(selectMyStatus(r.state)).toBe('leading');
  });

  it('still drops a repeat of the same type at one seq', () => {
    const once = run(base(), priceMsg(7, ME, 5_000), audit(7, ME, 5_000));
    const twice = run(once.state, priceMsg(7, ME, 5_000), audit(7, ME, 5_000));
    expect(twice.state).toEqual(once.state);
  });

  it('applies same-seq frames that arrive while resyncing, after the snapshot', () => {
    const gap = run(base(), priceMsg(9, ME, 5_000), audit(9, ME, 5_000));
    expect(gap.state.resyncing).toBe(true);
    expect(gap.state.held).toHaveLength(2);
    const snap = { ...openSnapshot(roster([ME, 'Me'], [9, 'Other'])), you };
    const done = run(gap.state, stateMsg(8, snap));
    expect(done.state.lastSeq).toBe(9);
    expect(done.state.audit).toHaveLength(1);
  });
});

describe('seq fillers for private frames (WEB-R2-02)', () => {
  it('does not resync or double-count when a filler repeats the price at the next seq', () => {
    const r = run(base(), priceMsg(7, ME, 5_000), priceMsg(8, ME, 5_000), priceMsg(9, ME, 5_000));
    expect(r.effects).toEqual([]);
    expect(r.state.lastSeq).toBe(9);
    expect(r.state.recentBids).toHaveLength(1);
  });
});

describe('reconnect snapshot (WEB-R2-03)', () => {
  it('keeps own bids so status and the ceiling meter survive a snapshot', () => {
    const live = run(base(), priceMsg(7, ME, 45_000), priceMsg(8, 9, 46_000)).state;
    expect(selectMyStatus(live)).toBe('outbid');
    const snap = {
      ...openSnapshot(roster([ME, 'Me'], [9, 'Other'])),
      you,
      price: Cents(46_000),
      leaderId: bidderId(9),
      minNext: Cents(46_500),
    };
    const after = run(live, stateMsg(20, snap)).state;
    expect(selectMyStatus(after)).toBe('outbid');
    expect(selectCeilingUsage(after)).toEqual({ usedCents: 45_000, maxCents: 50_000 });
  });
});

describe('status follows settlement (WEB-R2-04, R-WEB-090)', () => {
  const hammer = (winner: number): ServerMessage => ({
    v: 1,
    t: 'hammer',
    seq: 10,
    ts: EpochMs(BASE_TIME + 10),
    winnerId: bidderId(winner),
    price: Cents(35_000),
    ranking: [],
  });
  const settle = (seq: number, state: 'CAPTURED' | 'FAILED_NEEDS_REVIEW' | 'FALLBACK_RUNNER_UP') =>
    ({
      v: 1,
      t: 'settlement_update',
      seq,
      ts: EpochMs(BASE_TIME + seq),
      rev: seq,
      auctionState: 'CAPTURING',
      you: state,
    }) as ServerMessage;

  it('does not call a bidder the winner when their capture failed', () => {
    const won = run(base(), hammer(ME)).state;
    expect(selectMyStatus(won)).toBe('won');
    const failed = run(won, settle(11, 'FAILED_NEEDS_REVIEW')).state;
    expect(selectMyStatus(failed)).toBe('review');
  });

  it('shows won only once the capture is confirmed, and lost on a fallback', () => {
    const captured = run(base(), hammer(ME), settle(11, 'CAPTURED')).state;
    expect(selectMyStatus(captured)).toBe('won');
    const fallback = run(base(), hammer(ME), settle(11, 'FALLBACK_RUNNER_UP')).state;
    expect(selectMyStatus(fallback)).toBe('lost');
  });
});

describe('ladder invariant (WEB-R2-05, R-WEB-091)', () => {
  const view = (captured: number, released: number) => ({
    ...settlementView('CAPTURED', 12, [
      hold(12, 'Win', 50_000, 'CAPTURED', captured, released),
      hold(7, 'Other', 30_000, 'SETTLED', 0, 30_000),
    ]),
    hammerPriceCents: 35_000,
  });

  it('flags a capture of the ceiling instead of the winning price', () => {
    const m = buildLadder(view(50_000, 0));
    expect(m.invariants?.capturedWithinCeiling).toBe(false);
    expect(m.invariants?.violated).toBe(true);
  });

  it('accepts exactly the winning price', () => {
    const m = buildLadder(view(35_000, 15_000));
    expect(m.invariants?.capturedWithinCeiling).toBe(true);
    expect(m.invariants?.violated).toBe(false);
  });
});
