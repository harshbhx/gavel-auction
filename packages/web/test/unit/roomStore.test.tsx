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
import type { RoomSnapshot, ServerMessage, StateMessage } from '../../src/wire';

const config = {
  minIncrementCents: 1_000,
  reserveCents: 0,
  softCloseMs: 10_000,
  maxCeilingCents: 100_000,
  minCeilingCents: 5_000,
  lateEntry: true,
  mode: 'english',
} as const;

function snapshot(roomId: string, you?: RoomSnapshot['you']): RoomSnapshot {
  return {
    room: { id: roomId, name: roomId, status: 'OPEN', config },
    lot: { id: 'lot', title: 'Lot' },
    price: { currentCents: null, leaderPaddle: null, nextMinCents: 1_000, bidCount: 0 },
    bidders: [],
    ...(you === undefined ? {} : { you }),
  };
}

function stateMsg(roomId: string, seq: number, you?: RoomSnapshot['you']): StateMessage {
  return { t: 'state', seq, roomId, serverTime: seq, ...snapshot(roomId, you) };
}

const env = (roomId: string, seq: number) => ({ seq, roomId, serverTime: seq });
const wire = (msg: ServerMessage) => ({ kind: 'wire', msg }) as const;

const you = { bidderId: 'b1', paddle: 5, ceilingCents: 20_000, holdState: 'HELD' } as const;

function priceMsg(roomId: string, seq: number, leader: number, cents: number): ServerMessage {
  return {
    t: 'price',
    ...env(roomId, seq),
    currentCents: cents,
    leaderPaddle: leader,
    nextMinCents: cents + 1_000,
    bidCount: seq,
  };
}

describe('RoomStore', () => {
  it('resets all room state when navigating to another room (no leaked leader paddle)', () => {
    const store = new RoomStore('A');
    store.dispatch(wire(stateMsg('A', 1)));
    store.dispatch(wire(priceMsg('A', 2, 12, 5_000)));
    expect(selectPrice(store.getState())?.leaderPaddle).toBe(12);

    expect(store.enter('B')).toBe(true);
    expect(store.getState().roomId).toBe('B');
    expect(store.getState().snapshot).toBeNull();
    expect(store.getState().lastSeq).toBe(0);
    expect(selectPrice(store.getState())).toBeNull();

    store.dispatch(wire(stateMsg('B', 1)));
    expect(selectPrice(store.getState())?.leaderPaddle).toBeNull();
  });

  it('keeps state when entering the same room again', () => {
    const store = new RoomStore('A');
    store.dispatch(wire(stateMsg('A', 1)));
    const before = store.getState();
    expect(store.enter('A')).toBe(false);
    expect(store.getState()).toBe(before);
  });

  it('ignores late messages from the room it just left', () => {
    const store = new RoomStore('A');
    store.enter('B');
    store.dispatch(wire(stateMsg('A', 1)));
    expect(store.getState().snapshot).toBeNull();
  });

  it('notifies subscribers on change and not on a no-op', () => {
    const store = new RoomStore('A');
    const listener = vi.fn();
    const off = store.subscribe(listener);
    store.dispatch(wire(stateMsg('A', 1)));
    expect(listener).toHaveBeenCalledTimes(1);
    store.dispatch(wire(stateMsg('A', 1)));
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    store.dispatch(wire(priceMsg('A', 2, 1, 1_000)));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('passes reducer effects to handlers when a gap asks for a resync', () => {
    const store = new RoomStore('A');
    const handler = vi.fn();
    store.onEffect(handler);
    store.dispatch(wire(stateMsg('A', 1)));
    store.dispatch(wire(priceMsg('A', 4, 1, 1_000)));
    expect(handler).toHaveBeenCalledWith({
      type: 'send',
      msg: { t: 'join', roomId: 'A', resumeFromSeq: 1 },
    });
  });
});

describe('selectors', () => {
  it('derives myStatus and ceilingUsage', () => {
    const store = new RoomStore('A');
    expect(selectMyStatus(store.getState())).toBe('watching');
    store.dispatch(wire(stateMsg('A', 1, you)));
    expect(selectMyStatus(store.getState())).toBe('none');
    expect(selectCeilingUsage(store.getState())).toEqual({ usedCents: 0, maxCents: 20_000 });

    store.dispatch(wire({ t: 'bid', ...env('A', 2), paddle: 5, amountCents: 4_000 }));
    store.dispatch(wire(priceMsg('A', 3, 5, 4_000)));
    expect(selectMyStatus(store.getState())).toBe('leading');
    expect(selectCeilingUsage(store.getState())?.usedCents).toBe(4_000);

    store.dispatch(wire(priceMsg('A', 4, 9, 5_000)));
    expect(selectMyStatus(store.getState())).toBe('outbid');

    store.dispatch(wire(priceMsg('A', 5, 9, 25_000)));
    expect(selectMyStatus(store.getState())).toBe('atCeiling');

    store.dispatch(
      wire({
        t: 'hammer',
        ...env('A', 6),
        lotId: 'lot',
        winnerPaddle: 9,
        priceCents: 25_000,
        reserveMet: true,
      }),
    );
    expect(selectMyStatus(store.getState())).toBe('lost');
  });

  it('lists the stream newest first and exposes the confirm queue', () => {
    const store = new RoomStore('A');
    store.dispatch(wire(stateMsg('A', 1)));
    store.dispatch(wire({ t: 'bid', ...env('A', 2), paddle: 1, amountCents: 1_000 }));
    store.dispatch(wire({ t: 'bid', ...env('A', 3), paddle: 2, amountCents: 2_000 }));
    expect(selectStream(store.getState()).map((b) => b.paddle)).toEqual([2, 1]);
    expect(selectConfirmQueue(store.getState())).toEqual([]);
    expect(selectLadderRows(store.getState())).toEqual([]);
  });

  it('returns the same reference until the state changes', () => {
    const store = new RoomStore('A');
    store.dispatch(wire(stateMsg('A', 1)));
    expect(selectStream(store.getState())).toBe(selectStream(store.getState()));
    expect(selectLadderRows(store.getState())).toBe(selectLadderRows(store.getState()));
    const before = selectStream(store.getState());
    store.dispatch(wire({ t: 'bid', ...env('A', 2), paddle: 1, amountCents: 1_000 }));
    expect(selectStream(store.getState())).not.toBe(before);
  });
});

describe('useRoom', () => {
  it('re-renders on change and resets on room switch', () => {
    const store = new RoomStore('A');
    function Leader() {
      const price = useRoom(selectPrice, store);
      return <p data-testid="leader">{String(price?.leaderPaddle ?? 'none')}</p>;
    }
    render(<Leader />);
    expect(screen.getByTestId('leader').textContent).toBe('none');
    act(() => {
      store.dispatch(wire(stateMsg('A', 1)));
      store.dispatch(wire(priceMsg('A', 2, 12, 5_000)));
    });
    expect(screen.getByTestId('leader').textContent).toBe('12');
    act(() => {
      store.enter('B');
    });
    expect(screen.getByTestId('leader').textContent).toBe('none');
  });
});
