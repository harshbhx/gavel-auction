import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Announcer } from '../../src/a11y/Announcer';
import { BidScreen } from '../../src/screens/bid/BidScreen';
import { ScreenView } from '../../src/screens/screen/ScreenView';
import { ConfirmQueue } from '../../src/screens/console/ConfirmQueue';
import type { RoomEvent } from '../../src/store/roomReducer';
import { RoomStore } from '../../src/store/roomStore';
import type { ConfirmRequestMsg } from '../../src/wire';
import {
  baseConfig,
  bidderId,
  openSnapshot,
  priceMsg,
  roster,
  stateMsg,
} from '../../src/testing/builders';

const ME = bidderId(1);

function openStore(): RoomStore {
  const store = new RoomStore();
  const snap = {
    ...openSnapshot(roster([1, 'Me'], [2, 'Rival']), baseConfig, 'OPEN'),
    you: { bidderId: ME, ceiling: 100_000 },
  };
  store.dispatch({ kind: 'wire', msg: stateMsg(1, snap as never) }, 0);
  store.dispatch({ kind: 'wire', msg: priceMsg(2, 2, 10_000) }, 0);
  return store;
}

function wire(store: RoomStore, event: RoomEvent): void {
  act(() => store.dispatch(event, 0));
}

function bid(store: RoomStore, seq: number, paddle: number, cents: number): void {
  wire(store, { kind: 'wire', msg: priceMsg(seq, paddle, cents) });
}

function hammer(store: RoomStore, winner: number, cents: number): void {
  wire(store, {
    kind: 'wire',
    msg: {
      v: 1,
      t: 'hammer',
      seq: 50,
      ts: 1,
      winnerId: bidderId(winner),
      price: cents,
      ranking: [],
    } as never,
  });
}

const polite = (): string => screen.getByTestId('live-polite').textContent ?? '';
const assertive = (): string => screen.getByTestId('live-assertive').textContent ?? '';

/** Lets the announcer's two second gap pass between two polite messages. */
const pass = (ms = 2500): void => void act(() => void vi.advanceTimersByTime(ms));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('bidder route announcements (#2437)', () => {
  function mount(store: RoomStore) {
    render(
      <>
        <Announcer />
        <BidScreen store={store} onBid={() => undefined} myPaddle={1} />
      </>,
    );
  }

  it('says nothing for the state the page loads with', () => {
    mount(openStore());
    pass();
    expect(polite()).toBe('');
    expect(assertive()).toBe('');
  });

  it('speaks a rival bid, the bidder taking the lead, and an outbid once each', () => {
    const store = openStore();
    mount(store);
    bid(store, 3, 2, 12_000);
    expect(polite()).toBe('Current bid $120.00.');

    pass();
    bid(store, 4, 1, 13_000);
    pass();
    expect(polite()).toBe('You are leading at $130.00.');

    pass();
    bid(store, 5, 2, 14_000);
    pass();
    // The outbid message carries the price; the price change itself adds no second sentence.
    expect(polite()).toBe('You have been outbid. Current price $140.00.');
  });

  it('speaks the hammer assertively: lost, then won', () => {
    const lost = openStore();
    mount(lost);
    hammer(lost, 2, 10_000);
    expect(assertive()).toBe('Lot closed at $100.00. You did not win.');
    cleanup();

    const won = openStore();
    bid(won, 3, 1, 12_000);
    mount(won);
    pass(6000);
    hammer(won, 1, 12_000);
    expect(assertive()).toBe('You won at $120.00.');
  });
});

describe('public screen announcements (#2437)', () => {
  function mount(store: RoomStore) {
    render(
      <>
        <Announcer />
        <ScreenView lotTitle="Lot" code="ABC" joinUrl="https://x.test/j" store={store} />
      </>,
    );
  }

  it('keeps the result in the persistent live region when the price view is swapped out', () => {
    const store = openStore();
    mount(store);
    expect(assertive()).toBe('');
    hammer(store, 2, 14_000);
    expect(screen.getByTestId('sold')).toBeTruthy();
    expect(assertive()).toBe('SOLD to paddle 2 for $140.00');
  });

  it('stays silent in the hub preview', () => {
    const store = openStore();
    render(
      <>
        <Announcer />
        <ScreenView lotTitle="Lot" code="ABC" joinUrl="https://x.test/j" store={store} preview />
      </>,
    );
    hammer(store, 2, 14_000);
    expect(assertive()).toBe('');
  });
});

describe('background work stops when nothing can change (#2444)', () => {
  const tickCalls = (spy: ReturnType<typeof vi.spyOn>): number =>
    spy.mock.calls.filter((c) => c[1] === 250).length;

  it('runs the 250 ms clock tick on an open lot and not on a closed one', () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    render(<ScreenView lotTitle="Lot" code="ABC" joinUrl="https://x.test/j" store={openStore()} />);
    expect(tickCalls(spy)).toBe(1);
    cleanup();
    spy.mockClear();
    const closed = new RoomStore();
    closed.dispatch(
      { kind: 'wire', msg: stateMsg(1, openSnapshot(roster([2, 'Rival']), baseConfig, 'DONE')) },
      0,
    );
    render(<ScreenView lotTitle="Lot" code="ABC" joinUrl="https://x.test/j" store={closed} />);
    expect(tickCalls(spy)).toBe(0);
  });

  it('clears the tick when the hammer lands', () => {
    const clear = vi.spyOn(globalThis, 'clearInterval');
    const store = openStore();
    render(<ScreenView lotTitle="Lot" code="ABC" joinUrl="https://x.test/j" store={store} />);
    clear.mockClear();
    hammer(store, 2, 14_000);
    expect(clear).toHaveBeenCalled();
  });
});

describe('the confirm queue tick', () => {
  const second = (spy: ReturnType<typeof vi.spyOn>): number =>
    spy.mock.calls.filter((c) => c[1] === 1000).length;
  const pending = { v: 1, t: 'confirm_request', confirmId: 'c1', amount: 1, expiresAt: 9e9 };

  it('only runs while a confirmation waits', () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    const { rerender } = render(<ConfirmQueue requests={[]} now={() => 0} onAnswer={vi.fn()} />);
    expect(second(spy)).toBe(0);
    rerender(
      <ConfirmQueue
        requests={[pending as unknown as ConfirmRequestMsg]}
        now={() => 0}
        onAnswer={vi.fn()}
      />,
    );
    expect(second(spy)).toBe(1);
  });
});
