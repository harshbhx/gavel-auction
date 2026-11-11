import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { t } from '../../src/copy/t';
import { BidScreen } from '../../src/screens/bid/BidScreen';
import { RoomStore } from '../../src/store/roomStore';
import { bidderId, openSnapshot, priceMsg, roster, stateMsg } from '../../src/testing/builders';

const announce = vi.fn();
vi.mock('../../src/a11y/announce', () => ({ announce: (...a: unknown[]) => announce(...a) }));

function closedStore(winner: number): RoomStore {
  const store = new RoomStore();
  const snap = {
    ...openSnapshot(roster([12, 'Priya'], [7, 'Sam'])),
    status: 'CLOSING',
    you: { bidderId: bidderId(12), ceiling: 100_000 },
  };
  store.dispatch({ kind: 'wire', msg: stateMsg(1, snap as never) }, 0);
  store.dispatch({ kind: 'wire', msg: priceMsg(2, winner, 40_000) }, 0);
  store.dispatch(
    {
      kind: 'wire',
      msg: {
        v: 1,
        t: 'hammer',
        seq: 3,
        ts: 1,
        winnerId: bidderId(winner),
        price: 40_000,
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

describe('winner pop-up (UIX-60)', () => {
  it('opens a modal dialog for the winning bidder with both choices and the receipt', async () => {
    const { onHome, onJoinCode } = renderBid(closedStore(12));
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
    const { onHome, onReceipt, unmount } = renderBid(closedStore(12));
    fireEvent.click(await screen.findByRole('button', { name: t('end.home') }));
    expect(onHome).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    unmount();
    const again = renderBid(closedStore(12));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(again.onReceipt).not.toHaveBeenCalled();
    expect(onReceipt).not.toHaveBeenCalled();
  });

  it('closes with Escape and keeps the bid screen', async () => {
    renderBid(closedStore(12));
    await screen.findByRole('dialog');
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('main')).toBeTruthy();
  });

  it('never shows for a bidder who lost', () => {
    renderBid(closedStore(7));
    expect(screen.queryByRole('dialog')).toBeNull();
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
