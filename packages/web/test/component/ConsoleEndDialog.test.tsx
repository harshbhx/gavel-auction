import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../src/copy/t';
import { HOME_HREF, JOIN_ROOM_HREF } from '../../src/screens/console/ConsoleEndDialog';
import { ConsoleScreen, END_WATCH_MS } from '../../src/screens/console/ConsoleScreen';
import type { RoomEvent } from '../../src/store/roomReducer';
import { RoomStore } from '../../src/store/roomStore';
import { bidderId, openSnapshot, priceMsg, roster, stateMsg } from '../../src/testing/builders';
import { formatUsd } from '../../src/util/money';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** The console has watched the lot live for long enough that its end counts. */
function watch(): void {
  act(() => {
    vi.advanceTimersByTime(END_WATCH_MS);
  });
}

function openStore(): RoomStore {
  const store = new RoomStore();
  store.dispatch(
    { kind: 'wire', msg: stateMsg(1, openSnapshot(roster([12, 'Priya'], [7, 'Sam']))) },
    0,
  );
  store.dispatch({ kind: 'wire', msg: priceMsg(2, 12, 40_000) }, 0);
  return store;
}

function hammer(store: RoomStore, winner: number | null, price: number): void {
  const msg = {
    v: 1,
    t: 'hammer',
    seq: 3,
    ts: 1,
    winnerId: winner === null ? null : bidderId(winner),
    price,
    ranking: [],
  };
  act(() => {
    store.dispatch({ kind: 'wire', msg } as unknown as RoomEvent, 0);
  });
}

const popup = (): HTMLElement | null => screen.queryByRole('alertdialog');

describe('console end pop-up', () => {
  it('stays away while the lot is open', () => {
    render(<ConsoleScreen store={openStore()} settlementView={null} wide />);
    watch();
    expect(popup()).toBeNull();
  });

  it('opens when the lot is won, names the winner and offers Join room and Go home', () => {
    const store = openStore();
    render(<ConsoleScreen store={store} settlementView={null} wide />);
    watch();
    hammer(store, 12, 40_000);

    const box = popup();
    expect(box).not.toBeNull();
    expect(box?.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByRole('alertdialog', { name: t('console.end.title.sold') })).toBe(box);
    expect(
      screen.getByText(t('console.end.body.sold', { n: 12, amount: formatUsd(40_000) })),
    ).toBeTruthy();

    const join = screen.getByRole('link', { name: t('console.end.join') });
    const home = screen.getByRole('link', { name: t('console.end.home') });
    expect(join.getAttribute('href')).toBe(JOIN_ROOM_HREF);
    expect(home.getAttribute('href')).toBe(HOME_HREF);

    // The result line the console already showed is still there behind the pop-up.
    expect(
      screen.getByText(t('console.result.sold', { n: 12, amount: formatUsd(40_000) })),
    ).toBeTruthy();
  });

  it('puts focus on the panel first and keeps Tab inside', () => {
    const store = openStore();
    render(<ConsoleScreen store={store} settlementView={null} wide />);
    watch();
    hammer(store, 12, 40_000);

    const box = popup() as HTMLElement;
    expect(document.activeElement).toBe(box);

    const join = screen.getByRole('link', { name: t('console.end.join') });
    const stay = screen.getByRole('button', { name: t('console.end.stay') });
    stay.focus();
    fireEvent.keyDown(stay, { key: 'Tab' });
    expect(document.activeElement).toBe(join);
    fireEvent.keyDown(join, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(stay);
  });

  it('closes on Escape, keeps the console as it was and does not come back', () => {
    const store = openStore();
    render(<ConsoleScreen store={store} settlementView={null} wide />);
    watch();
    hammer(store, 12, 40_000);
    expect(popup()).not.toBeNull();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(popup()).toBeNull();
    expect(
      screen.getByText(t('console.result.sold', { n: 12, amount: formatUsd(40_000) })),
    ).toBeTruthy();
    expect(screen.getByText(t('console.clockClosed'))).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(popup()).toBeNull();
  });

  it('closes from the Stay button', () => {
    const store = openStore();
    render(<ConsoleScreen store={store} settlementView={null} wide={false} />);
    watch();
    hammer(store, 12, 40_000);
    fireEvent.click(screen.getByRole('button', { name: t('console.end.stay') }));
    expect(popup()).toBeNull();
  });

  it('says no sale when the lot closes without a winner', () => {
    const store = openStore();
    render(<ConsoleScreen store={store} settlementView={null} wide />);
    watch();
    hammer(store, null, 40_000);
    expect(screen.getByRole('alertdialog', { name: t('console.end.title.noSale') })).toBeTruthy();
    expect(screen.getByText(t('console.end.body.noSale'))).toBeTruthy();
    expect(screen.getByRole('link', { name: t('console.end.join') })).toBeTruthy();
    expect(screen.getByRole('link', { name: t('console.end.home') })).toBeTruthy();
  });

  it('says the auction was stopped when the stop is accepted here', () => {
    const store = openStore();
    const view = render(<ConsoleScreen store={store} settlementView={null} wide />);
    watch();
    expect(popup()).toBeNull();
    view.rerender(<ConsoleScreen store={store} settlementView={null} wide stoppedHere />);
    expect(screen.getByRole('alertdialog', { name: t('console.end.title.stopped') })).toBeTruthy();
    expect(screen.getByText(t('console.end.body.stopped'))).toBeTruthy();
  });

  it('does not open while the console is still catching up on the room history', () => {
    const store = openStore();
    render(<ConsoleScreen store={store} settlementView={null} wide />);
    hammer(store, 12, 40_000);
    watch();
    expect(popup()).toBeNull();
  });

  it('does not open on a console that loads after the lot has ended', () => {
    const store = openStore();
    hammer(store, 12, 40_000);
    render(<ConsoleScreen store={store} settlementView={null} wide />);
    watch();
    expect(popup()).toBeNull();
    expect(
      screen.getByText(t('console.result.sold', { n: 12, amount: formatUsd(40_000) })),
    ).toBeTruthy();
  });
});
