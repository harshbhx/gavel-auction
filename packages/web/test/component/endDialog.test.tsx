import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { t } from '../../src/copy/t';
import { BidScreen } from '../../src/screens/bid/BidScreen';
import { RoomStore } from '../../src/store/roomStore';
import { bidderId, openSnapshot, priceMsg, roster, stateMsg } from '../../src/testing/builders';

const announce = vi.fn();
vi.mock('../../src/a11y/announce', () => ({ announce: (...a: unknown[]) => announce(...a) }));

interface Ending {
  /** The paddle that won, or null when the lot closed with no sale. */
  winner: number | null;
  /** False: this screen belongs to someone who holds no limit (a watcher). */
  registered?: boolean;
}

function closedStore({ winner, registered = true }: Ending): RoomStore {
  const store = new RoomStore();
  const base = {
    ...openSnapshot(roster([12, 'Priya'], [7, 'Sam'])),
    status: 'CLOSING',
  };
  const snap = registered ? { ...base, you: { bidderId: bidderId(12), ceiling: 100_000 } } : base;
  store.dispatch({ kind: 'wire', msg: stateMsg(1, snap as never) }, 0);
  if (winner !== null) store.dispatch({ kind: 'wire', msg: priceMsg(2, winner, 40_000) }, 0);
  store.dispatch(
    {
      kind: 'wire',
      msg: {
        v: 1,
        t: 'hammer',
        seq: 3,
        ts: 1,
        winnerId: winner === null ? null : bidderId(winner),
        price: winner === null ? 0 : 40_000,
        ranking: [],
      } as never,
    },
    0,
  );
  return store;
}

function renderBid(store: RoomStore, handlers = true) {
  const onHome = vi.fn();
  const onJoinCode = vi.fn();
  const onReceipt = vi.fn();
  const view = render(
    <BidScreen
      store={store}
      onBid={() => undefined}
      myPaddle={12}
      {...(handlers ? { onHome, onJoinCode, onReceipt } : {})}
    />,
  );
  return { ...view, onHome, onJoinCode, onReceipt };
}

beforeEach(() => {
  announce.mockClear();
  window.sessionStorage.clear();
});
afterEach(() => window.sessionStorage.clear());

describe('end pop-up for the winner', () => {
  it('opens a modal dialog for the winning bidder with both choices and the receipt', async () => {
    const { onHome, onJoinCode } = renderBid(closedStore({ winner: 12 }));
    const dialog = await screen.findByRole('dialog', { name: t('win.title') });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.textContent).toContain('$400.00');
    expect(dialog.textContent).toContain(t('win.money', { amount: '$400.00' }));
    expect(screen.getByRole('button', { name: t('win.receipt') })).toBeTruthy();
    expect(
      announce.mock.calls.some((c) => String(c[1]) === t('end.announce', { amount: '$400.00' })),
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: t('end.join') }));
    expect(onJoinCode).toHaveBeenCalledTimes(1);
    expect(onHome).not.toHaveBeenCalled();
  });

  it('routes home and to the receipt, then stays gone for the same lot', async () => {
    const { onHome, onReceipt, unmount } = renderBid(closedStore({ winner: 12 }));
    fireEvent.click(await screen.findByRole('button', { name: t('end.home') }));
    expect(onHome).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    unmount();
    const again = renderBid(closedStore({ winner: 12 }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(again.onReceipt).not.toHaveBeenCalled();
    expect(onReceipt).not.toHaveBeenCalled();
  });

  it('closes with Escape and keeps the bid screen', async () => {
    renderBid(closedStore({ winner: 12 }));
    await screen.findByRole('dialog');
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('main')).toBeTruthy();
  });

  it('never shows while the lot is open', () => {
    const store = new RoomStore();
    const snap = {
      ...openSnapshot(roster([12, 'Priya'])),
      you: { bidderId: bidderId(12), ceiling: 100_000 },
    };
    store.dispatch({ kind: 'wire', msg: stateMsg(1, snap as never) }, 0);
    renderBid(store);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('end pop-up for everyone', () => {
  function expectBothButtons(): void {
    expect(screen.getByRole('button', { name: t('end.join') })).toBeTruthy();
    expect(screen.getByRole('button', { name: t('end.home') })).toBeTruthy();
  }

  it('tells a bidder who lost who won, with both buttons and the receipt', async () => {
    const { onHome, onJoinCode, onReceipt } = renderBid(closedStore({ winner: 7 }));
    const dialog = await screen.findByRole('dialog', { name: t('end.title.lost') });
    expect(screen.getByTestId('end-dialog').getAttribute('data-outcome')).toBe('lost');
    expect(dialog.textContent).toContain('$400.00');
    expect(dialog.textContent).toContain(t('end.sold.paddle', { n: 7 }));
    expect(dialog.textContent).toContain(t('end.money.lost'));
    expect(screen.queryByText(t('win.title'))).toBeNull();
    expectBothButtons();
    fireEvent.click(screen.getByRole('button', { name: t('win.receipt') }));
    expect(onReceipt).toHaveBeenCalledTimes(1);
    expect(onHome).not.toHaveBeenCalled();
    expect(onJoinCode).not.toHaveBeenCalled();
  });

  it('routes a loser to join room and to home', async () => {
    const first = renderBid(closedStore({ winner: 7 }));
    fireEvent.click(await screen.findByRole('button', { name: t('end.join') }));
    expect(first.onJoinCode).toHaveBeenCalledTimes(1);
    first.unmount();
    window.sessionStorage.clear();
    const second = renderBid(closedStore({ winner: 7 }));
    fireEvent.click(await screen.findByRole('button', { name: t('end.home') }));
    expect(second.onHome).toHaveBeenCalledTimes(1);
  });

  it('shows a watcher who holds no limit that the lot sold, with no receipt', async () => {
    renderBid(closedStore({ winner: 7, registered: false }));
    const dialog = await screen.findByRole('dialog', { name: t('end.title.sold') });
    expect(dialog.textContent).toContain('$400.00');
    expect(dialog.textContent).not.toContain(t('end.money.lost'));
    expectBothButtons();
    expect(screen.queryByRole('button', { name: t('win.receipt') })).toBeNull();
  });

  it('says there was no sale to a bidder, with both buttons and no receipt', async () => {
    const { onHome, onJoinCode } = renderBid(closedStore({ winner: null }));
    const dialog = await screen.findByRole('dialog', { name: t('end.title.noSale') });
    expect(screen.getByTestId('end-dialog').getAttribute('data-outcome')).toBe('noSale');
    expect(dialog.textContent).toContain(t('end.noSale.hold'));
    expect(dialog.textContent).not.toContain('$0.00');
    expect(screen.queryByRole('button', { name: t('win.receipt') })).toBeNull();
    expect(announce.mock.calls.some((c) => String(c[1]) === t('end.announce.noSale'))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: t('end.home') }));
    expect(onHome).toHaveBeenCalledTimes(1);
    expect(onJoinCode).not.toHaveBeenCalled();
  });

  it('says there was no sale to a watcher too', async () => {
    renderBid(closedStore({ winner: null, registered: false }));
    await screen.findByRole('dialog', { name: t('end.title.noSale') });
    expectBothButtons();
  });

  it('shows once per lot and closes with Escape for every outcome', async () => {
    const first = renderBid(closedStore({ winner: 7 }));
    await screen.findByRole('dialog');
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    first.unmount();
    renderBid(closedStore({ winner: 7 }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('stays out of the way without the home and join handlers', () => {
    renderBid(closedStore({ winner: 7 }), false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
