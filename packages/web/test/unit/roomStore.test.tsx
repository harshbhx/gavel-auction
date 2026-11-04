import { Cents, EpochMs } from '@gavel/shared';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RoomStore, useRoom } from '../../src/store/roomStore';
import {
  selectCeilingUsage,
  selectConfirmQueue,
  selectLadderRows,
  selectMyStatus,
  selectPrice,
  selectStream,
} from '../../src/store/selectors';
import {
  BASE_TIME,
  auctionId,
  bidderId,
  openSnapshot,
  priceMsg,
  roster,
  stateMsg,
} from '../../src/testing/builders';
import type { RoomSnapshot, ServerMessage } from '../../src/wire';

const A = auctionId(1);
const B = auctionId(2);

function snapshot(id: string, you?: RoomSnapshot['you']): RoomSnapshot {
  const base = openSnapshot(roster([5, 'Eve']), undefined, 'OPEN', id as typeof A);
  return you === undefined ? base : { ...base, you };
}

const wire = (msg: ServerMessage) => ({ kind: 'wire', msg }) as const;

const you = { bidderId: bidderId(5), ceiling: Cents(20_000) };

describe('RoomStore', () => {
  it('resets all room state when navigating to another auction (no leaked leader)', () => {
    const store = new RoomStore(A);
    store.dispatch(wire(stateMsg(1, snapshot(A))));
    store.dispatch(wire(priceMsg(2, 12, 5_000)));
    expect(selectPrice(store.getState())?.leaderPaddle).toBe(12);

    expect(store.enter(B)).toBe(true);
    expect(store.getState().auctionId).toBe(B);
    expect(store.getState().snapshot).toBeNull();
    expect(store.getState().lastSeq).toBe(0);
    expect(selectPrice(store.getState())).toBeNull();

    store.dispatch(wire(stateMsg(1, snapshot(B))));
    expect(selectPrice(store.getState())?.leaderPaddle).toBeNull();
  });

  it('keeps state when entering the same auction again', () => {
    const store = new RoomStore(A);
    store.dispatch(wire(stateMsg(1, snapshot(A))));
    const before = store.getState();
    expect(store.enter(A)).toBe(false);
    expect(store.getState()).toBe(before);
  });

  it('ignores a late snapshot from the auction it just left', () => {
    const store = new RoomStore(A);
    store.enter(B);
    store.dispatch(wire(stateMsg(1, snapshot(A))));
    expect(store.getState().snapshot).toBeNull();
  });

  it('notifies subscribers on change and not on a no-op', () => {
    const store = new RoomStore(A);
    const listener = vi.fn();
    const off = store.subscribe(listener);
    store.dispatch(wire(stateMsg(1, snapshot(A))));
    expect(listener).toHaveBeenCalledTimes(1);
    store.dispatch(wire(stateMsg(1, snapshot(A))));
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    store.dispatch(wire(priceMsg(2, 1, 1_000)));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('passes reducer effects to handlers when a gap asks for a resync', () => {
    const store = new RoomStore(A);
    const handler = vi.fn();
    store.onEffect(handler);
    store.dispatch(wire(stateMsg(1, snapshot(A))));
    store.dispatch(wire(priceMsg(4, 1, 1_000)));
    expect(handler).toHaveBeenCalledWith({ type: 'resync', lastSeq: 1 });
  });
});

describe('clock offset (R-WEB-026)', () => {
  it('is zero before any message', () => {
    expect(new RoomStore(A).getClockOffsetMs()).toBe(0);
  });

  it('estimates a skewed phone clock to within the best delay', () => {
    const store = new RoomStore(A);
    const skew = -90_000; // the phone is 90 s behind the server
    const sendAt = (seq: number, delay: number) => {
      const msg = priceMsg(seq, 1, seq * 1_000);
      const ts = Number(msg.ts);
      store.dispatch(wire(msg), ts + skew + delay);
    };
    store.dispatch(wire(stateMsg(1, snapshot(A), BASE_TIME + 1)), BASE_TIME + 1 + skew + 400);
    sendAt(2, 250);
    sendAt(3, 30);
    sendAt(4, 180);
    const offset = store.getClockOffsetMs();
    expect(offset).toBeLessThanOrEqual(90_000);
    expect(offset).toBeGreaterThanOrEqual(90_000 - 30);
  });

  it('starts over when entering another auction', () => {
    const store = new RoomStore(A);
    store.dispatch(wire(stateMsg(1, snapshot(A), BASE_TIME + 5_000)), BASE_TIME);
    store.enter(B);
    expect(store.getClockOffsetMs()).toBe(0);
  });
});

describe('selectors', () => {
  it('derives myStatus and ceilingUsage', () => {
    const store = new RoomStore(A);
    expect(selectMyStatus(store.getState())).toBe('watching');
    store.dispatch(wire(stateMsg(1, snapshot(A, you))));
    expect(selectMyStatus(store.getState())).toBe('none');
    expect(selectCeilingUsage(store.getState())).toEqual({ usedCents: 0, maxCents: 20_000 });

    store.dispatch(wire(priceMsg(2, 5, 4_000)));
    expect(selectMyStatus(store.getState())).toBe('leading');
    expect(selectCeilingUsage(store.getState())?.usedCents).toBe(4_000);

    store.dispatch(wire(priceMsg(3, 9, 5_000)));
    expect(selectMyStatus(store.getState())).toBe('outbid');

    store.dispatch(wire(priceMsg(4, 9, 25_000)));
    expect(selectMyStatus(store.getState())).toBe('atCeiling');

    store.dispatch(
      wire({
        v: 1,
        t: 'hammer',
        seq: 5,
        ts: EpochMs(BASE_TIME + 5),
        winnerId: bidderId(9),
        price: Cents(25_000),
        ranking: [],
      }),
    );
    expect(selectMyStatus(store.getState())).toBe('lost');
  });

  it('lists the stream newest first and exposes the confirm queue', () => {
    const store = new RoomStore(A);
    store.dispatch(wire(stateMsg(1, snapshot(A))));
    store.dispatch(wire(priceMsg(2, 1, 1_000)));
    store.dispatch(wire(priceMsg(3, 2, 2_000)));
    expect(selectStream(store.getState()).map((b) => b.paddle)).toEqual([2, 1]);
    expect(selectConfirmQueue(store.getState())).toEqual([]);
  });

  it('lists the roster holds', () => {
    const store = new RoomStore(A);
    expect(selectLadderRows(store.getState())).toEqual([]);
    store.dispatch(wire(stateMsg(1, snapshot(A))));
    expect(selectLadderRows(store.getState())).toEqual([
      { bidderId: bidderId(5), paddle: 5, name: 'Eve', state: 'HELD' },
    ]);
  });

  it('returns the same reference until the state changes', () => {
    const store = new RoomStore(A);
    store.dispatch(wire(stateMsg(1, snapshot(A))));
    expect(selectStream(store.getState())).toBe(selectStream(store.getState()));
    expect(selectLadderRows(store.getState())).toBe(selectLadderRows(store.getState()));
    expect(selectPrice(store.getState())).toBe(selectPrice(store.getState()));
    const before = selectStream(store.getState());
    store.dispatch(wire(priceMsg(2, 1, 1_000)));
    expect(selectStream(store.getState())).not.toBe(before);
  });
});

describe('useRoom', () => {
  it('re-renders on change and resets on room switch', () => {
    const store = new RoomStore(A);
    function Leader() {
      const price = useRoom(selectPrice, store);
      return <p data-testid="leader">{String(price?.leaderPaddle ?? 'none')}</p>;
    }
    render(<Leader />);
    expect(screen.getByTestId('leader').textContent).toBe('none');
    act(() => {
      store.dispatch(wire(stateMsg(1, snapshot(A))));
      store.dispatch(wire(priceMsg(2, 12, 5_000)));
    });
    expect(screen.getByTestId('leader').textContent).toBe('12');
    act(() => {
      store.enter(B);
    });
    expect(screen.getByTestId('leader').textContent).toBe('none');
  });
});
