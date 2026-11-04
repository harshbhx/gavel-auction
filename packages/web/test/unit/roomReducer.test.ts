import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { initialRoomState, reduce, type Effect, type RoomState } from '../../src/store/roomReducer';
import type { ServerMessage, StateMessage } from '../../src/wire';

const ROOM = 'room-1';

function bid(seq: number): ServerMessage {
  return {
    t: 'bid',
    seq,
    roomId: ROOM,
    serverTime: seq,
    paddle: 1 + (seq % 3),
    amountCents: seq * 1_000,
  };
}

function snapshot(seq: number): StateMessage {
  return {
    t: 'state',
    seq,
    roomId: ROOM,
    serverTime: seq,
    room: {
      id: ROOM,
      name: 'Demo',
      status: 'OPEN',
      config: {
        minIncrementCents: 1_000,
        reserveCents: 0,
        softCloseMs: 10_000,
        maxCeilingCents: 100_000,
        minCeilingCents: 5_000,
        lateEntry: true,
        mode: 'english',
      },
    },
    lot: { id: 'lot-1', title: 'Clock' },
    price: {
      currentCents: seq * 1_000,
      leaderPaddle: 1,
      nextMinCents: seq * 1_000 + 1_000,
      bidCount: seq,
    },
    bidders: [],
  };
}

function run(msgs: readonly ServerMessage[], from: RoomState = initialRoomState(ROOM)) {
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
    expect(gap.effects).toEqual([
      { type: 'send', msg: { t: 'join', roomId: ROOM, resumeFromSeq: 2 } },
    ]);

    const more = run([bid(6), bid(7)], gap.state);
    expect(more.effects).toEqual([]);
    expect(more.state.lastSeq).toBe(2);

    const healed = run([snapshot(9), bid(10)], gap.state);
    expect(healed.state.resyncing).toBe(false);
    expect(healed.state.lastSeq).toBe(10);
    expect(healed.state.recentBids.map((b) => b.seq)).toEqual([10]);
    expect(healed.state.snapshot?.price.bidCount).toBe(9);
  });

  it('a snapshot replaces earlier state and sets lastSeq', () => {
    const r = run([bid(1), bid(2), snapshot(4)]);
    expect(r.state.lastSeq).toBe(4);
    expect(r.state.recentBids).toEqual([]);
  });

  it('ignores an old snapshot', () => {
    const r = run([snapshot(8), snapshot(5)]);
    expect(r.state.lastSeq).toBe(8);
    expect(r.state.snapshot?.price.bidCount).toBe(8);
  });

  it('applies price to the snapshot', () => {
    const r = run([
      snapshot(1),
      {
        t: 'price',
        seq: 2,
        roomId: ROOM,
        serverTime: 2,
        currentCents: 40_000,
        leaderPaddle: 7,
        nextMinCents: 41_000,
        bidCount: 4,
      },
    ]);
    expect(r.state.snapshot?.price).toEqual({
      currentCents: 40_000,
      leaderPaddle: 7,
      nextMinCents: 41_000,
      bidCount: 4,
    });
  });

  it('reset starts seq numbering over', () => {
    const r = reduce(run([bid(1), bid(2)]).state, { kind: 'reset' });
    expect(r.state).toEqual(initialRoomState(ROOM));
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
