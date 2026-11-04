import { Cents, EpochMs } from '@gavel/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { initialRoomState, reduce, type Effect, type RoomState } from '../../src/store/roomReducer';
import {
  BASE_TIME,
  bidderId,
  openSnapshot,
  priceMsg,
  roster,
  stateMsg,
} from '../../src/testing/builders';
import type { ServerMessage } from '../../src/wire';

const AUCTION = 'a1';

/** A price message stands for one accepted bid. */
function bid(seq: number): ServerMessage {
  return priceMsg(seq, 1 + (seq % 3), seq * 1_000);
}

function snapshot(seq: number): ServerMessage {
  return stateMsg(seq, {
    ...openSnapshot(roster([1, 'A'])),
    price: Cents(seq * 1_000),
    leaderId: bidderId(1),
    minNext: Cents(seq * 1_000 + 1_000),
  });
}

function run(msgs: readonly ServerMessage[], from: RoomState = initialRoomState(AUCTION)) {
  let state = from;
  const effects: Effect[] = [];
  for (const msg of msgs) {
    const r = reduce(state, { kind: 'wire', msg });
    state = r.state;
    effects.push(...r.effects);
  }
  return { state, effects };
}

describe('room reducer', () => {
  it('T-WEB-010: replay of seq [1,2,2,3] equals [1,2,3]', () => {
    const dup = run([bid(1), bid(2), bid(2), bid(3)]);
    const plain = run([bid(1), bid(2), bid(3)]);
    expect(dup.state).toEqual(plain.state);
    expect(dup.state.lastSeq).toBe(3);
    expect(dup.effects).toEqual([]);
  });

  it('T-WEB-011: a gap resyncs once, a snapshot clears it, later seq applies', () => {
    const gap = run([bid(1), bid(2), bid(5)]);
    expect(gap.state.resyncing).toBe(true);
    expect(gap.state.lastSeq).toBe(2);
    expect(gap.effects).toEqual([{ type: 'resync', lastSeq: 2 }]);

    const more = run([bid(6), bid(7)], gap.state);
    expect(more.effects).toEqual([]);
    expect(more.state.lastSeq).toBe(2);

    const healed = run([snapshot(9), bid(10)], gap.state);
    expect(healed.state.resyncing).toBe(false);
    expect(healed.state.lastSeq).toBe(10);
    expect(healed.state.recentBids.map((b) => b.seq)).toEqual([10]);
    expect(healed.state.snapshot?.price).toBe(10_000);
  });

  it('a snapshot replaces earlier state and sets lastSeq', () => {
    const r = run([bid(1), bid(2), snapshot(4)]);
    expect(r.state.lastSeq).toBe(4);
    expect(r.state.recentBids).toEqual([]);
  });

  it('ignores a repeat of the same snapshot', () => {
    const r = run([snapshot(8), snapshot(8)]);
    expect(r.state.lastSeq).toBe(8);
    expect(r.state.snapshot?.price).toBe(8_000);
  });

  it('applies price to the snapshot', () => {
    const r = run([snapshot(1), priceMsg(2, 7, 40_000)]);
    expect(r.state.snapshot).toMatchObject({
      price: 40_000,
      leaderId: bidderId(7),
      minNext: 45_000,
    });
    expect(r.state.leaderPaddle).toBe(7);
  });

  it('reset starts seq numbering over', () => {
    const r = reduce(run([bid(1), bid(2)]).state, { kind: 'reset' });
    expect(r.state).toEqual(initialRoomState(AUCTION));
  });

  it('does not mutate the previous state', () => {
    const before = run([bid(1)]).state;
    const frozen = structuredClone(before);
    reduce(before, { kind: 'wire', msg: bid(2) });
    expect(before).toEqual(frozen);
  });

  it('T-WEB-012: shuffled streams with duplicates recover to the in-order state after a snapshot', () => {
    const N = 12;
    const ordered = Array.from({ length: N }, (_, i) => bid(i + 1));
    const finalSnapshot = snapshot(N + 1);
    const expected = run([...ordered, finalSnapshot, bid(N + 2)]).state;

    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: N - 1 }), { maxLength: 40 }), (picks) => {
        const stream = picks.flatMap((i) => {
          const m = ordered[i];
          return m === undefined ? [] : [m];
        });
        expect(run([...stream, finalSnapshot, bid(N + 2)]).state).toEqual(expected);
      }),
      { numRuns: 100 },
    );
  });

  it('duplicates alone never change the in-order result', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 10 }), { maxLength: 30 }), (extra) => {
        const base = Array.from({ length: 10 }, (_, i) => bid(i + 1));
        const noisy: ServerMessage[] = [];
        base.forEach((m, i) => {
          noisy.push(m);
          for (const e of extra) if (e === i + 1) noisy.push(m);
        });
        expect(run(noisy).state).toEqual(run(base).state);
      }),
      { numRuns: 100 },
    );
  });
});

describe('resync (WEB-RT-05)', () => {
  it('accepts a snapshot with a lower seq while resyncing (server restarted its numbering)', () => {
    const gap = run([snapshot(40), bid(41), bid(44)]);
    expect(gap.state.resyncing).toBe(true);
    const healed = run([snapshot(3)], gap.state);
    expect(healed.state.resyncing).toBe(false);
    expect(healed.state.lastSeq).toBe(3);
    const next = run([bid(4)], healed.state);
    expect(next.state.lastSeq).toBe(4);
  });

  it('accepts a lower-seq snapshot even when no resync was pending', () => {
    const r = run([snapshot(40), snapshot(2)]);
    expect(r.state.lastSeq).toBe(2);
  });

  it('keeps messages that arrive during a resync and applies the ones after the snapshot', () => {
    const gap = run([snapshot(1), bid(2), bid(5), bid(6), bid(7), bid(8)]);
    expect(gap.state.resyncing).toBe(true);
    expect(gap.state.held.map((m) => m.seq)).toEqual([5, 6, 7, 8]);
    const healed = run([snapshot(6)], gap.state);
    expect(healed.state.resyncing).toBe(false);
    expect(healed.state.lastSeq).toBe(8);
    expect(healed.state.recentBids.map((b) => b.seq)).toEqual([7, 8]);
    expect(healed.state.held).toEqual([]);
  });

  it('drops what cannot be joined to the snapshot, and the next live gap asks again', () => {
    const gap = run([snapshot(1), bid(5), bid(9)]);
    const healed = run([snapshot(4)], gap.state);
    expect(healed.state.lastSeq).toBe(5);
    expect(healed.state.resyncing).toBe(false);
    expect(healed.state.held).toEqual([]);
    const next = run([bid(12)], healed.state);
    expect(next.effects).toEqual([{ type: 'resync', lastSeq: 5 }]);
  });

  it('shows an error that has no seq without touching the sequence', () => {
    const r = run([
      snapshot(3),
      { v: 1, t: 'error', code: 'unauthorized', message: 'bad token', retryAfterMs: 500 },
    ]);
    expect(r.state.lastSeq).toBe(3);
    expect(r.state.lastError).toEqual({
      code: 'unauthorized',
      message: 'bad token',
      retryAfterMs: 500,
    });
  });
});

describe('snapshot keeps what only the client knows (WEB-RT-06)', () => {
  const hammer = (seq: number): ServerMessage => ({
    v: 1,
    t: 'hammer',
    seq,
    ts: EpochMs(BASE_TIME + seq),
    winnerId: bidderId(7),
    price: Cents(20_000),
    ranking: [],
  });
  const confirm = (seq: number, expiresAt: number): ServerMessage => ({
    v: 1,
    t: 'confirm_request',
    seq,
    ts: EpochMs(BASE_TIME + seq),
    confirmId: 'c1',
    amount: Cents(15_000),
    expiresAt: EpochMs(expiresAt),
  });
  const closed = (seq: number): ServerMessage =>
    stateMsg(seq, openSnapshot(roster([7, 'Sam']), undefined, 'DONE'));

  it('keeps the hammer when a snapshot of a closed auction arrives', () => {
    const r = run([snapshot(1), hammer(2), closed(3)]);
    expect(r.state.hammer?.winnerId).toBe(bidderId(7));
  });

  it('drops the hammer when the snapshot says bidding is open again', () => {
    const r = run([snapshot(1), hammer(2), stateMsg(3, openSnapshot([]))]);
    expect(r.state.hammer).toBeNull();
  });

  it('keeps a confirmation that has not expired and drops one that has', () => {
    const live = run([snapshot(1), confirm(2, BASE_TIME + 60_000), snapshot(3)]);
    expect(live.state.confirmRequests.map((c) => c.confirmId)).toEqual(['c1']);
    const stale = run([snapshot(1), confirm(2, BASE_TIME + 1), snapshot(3)]);
    expect(stale.state.confirmRequests).toEqual([]);
  });

  it('takes the audit trail from the snapshot', () => {
    const r = run([snapshot(1), snapshot(2)]);
    expect(r.state.audit).toEqual([]);
  });

  it('a confirmation leaves the queue when it is answered', () => {
    const r = reduce(run([snapshot(1), confirm(2, BASE_TIME + 60_000)]).state, {
      kind: 'confirm_resolved',
      confirmId: 'c1',
    });
    expect(r.state.confirmRequests).toEqual([]);
  });
});

describe('registered (WEB-RT-15)', () => {
  const registered = (seq: number, paddle: number): ServerMessage => ({
    v: 1,
    t: 'registered',
    seq,
    ts: EpochMs(BASE_TIME + seq),
    bidderId: bidderId(paddle),
    paddle,
    ceiling: Cents(20_000),
    role: 'bidder',
  });

  it('adopts the identity of the session it was issued to', () => {
    const start = reduce(initialRoomState(AUCTION), {
      kind: 'identify',
      bidderId: bidderId(5),
    }).state;
    const r = run([snapshot(1), registered(2, 5)], start);
    expect(r.state.me).toEqual({ bidderId: bidderId(5), paddle: 5, ceiling: 20_000 });
  });

  it('ignores a registered message for another bidder', () => {
    const start = reduce(initialRoomState(AUCTION), {
      kind: 'identify',
      bidderId: bidderId(5),
    }).state;
    const r = run([snapshot(1), registered(2, 9)], start);
    expect(r.state.me).toBeNull();
    expect(r.state.lastSeq).toBe(2);
  });

  it('does not switch to a second identity once one is set', () => {
    const r = run([snapshot(1), registered(2, 5), registered(3, 9)]);
    expect(r.state.me?.bidderId).toBe(bidderId(5));
  });

  it('keeps the identity across a snapshot', () => {
    const r = run([snapshot(1), registered(2, 5), snapshot(3)]);
    expect(r.state.me?.bidderId).toBe(bidderId(5));
  });

  it('settlement updates only move forward by rev', () => {
    const upd = (
      seq: number,
      rev: number,
      auctionState: 'CAPTURING' | 'CAPTURED',
    ): ServerMessage => ({
      v: 1,
      t: 'settlement_update',
      seq,
      ts: EpochMs(BASE_TIME + seq),
      rev,
      auctionState,
    });
    const r = run([snapshot(1), upd(2, 2, 'CAPTURED'), upd(3, 1, 'CAPTURING')]);
    expect(r.state.snapshot?.settlement).toEqual({ rev: 2, auctionState: 'CAPTURED' });
  });
});
