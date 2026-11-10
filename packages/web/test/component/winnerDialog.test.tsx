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
  window.localStorage.clear();
});
afterEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
});

function savedRecords(): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (key !== null && key.startsWith('gavel:winner:')) {
      out.push(JSON.parse(window.localStorage.getItem(key) ?? '{}') as Record<string, unknown>);
    }
  }
  return out;
}

describe('winner pop-up (UIX-60)', () => {
  it('opens a modal dialog for the winning bidder with both choices and the receipt', async () => {
    const { onHome, onJoinCode } = renderBid(closedStore(12));
    const dialog = await screen.findByRole('dialog', { name: t('win.title') });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.textContent).toContain('$400.00');
    expect(dialog.textContent).toContain(t('win.money', { amount: '$400.00' }));
    expect(screen.getByRole('button', { name: t('win.receipt') })).toBeTruthy();
    expect(
      announce.mock.calls.some((c) => String(c[1]) === t('win.announce', { amount: '$400.00' })),
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: t('win.joinCode') }));
    expect(onJoinCode).toHaveBeenCalledTimes(1);
    expect(onHome).not.toHaveBeenCalled();
  });

  it('routes home and to the receipt, then stays gone for the same lot', async () => {
    const { onHome, onReceipt, unmount } = renderBid(closedStore(12));
    fireEvent.click(await screen.findByRole('button', { name: t('win.home') }));
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

  it('renders the email and contact fields with the on-device note', async () => {
    renderBid(closedStore(12));
    await screen.findByRole('dialog');
    expect(screen.getByLabelText(t('win.email'))).toBeTruthy();
    expect(screen.getByLabelText(t('win.phone'))).toBeTruthy();
    expect(screen.getByText(t('win.local'))).toBeTruthy();
  });

  it('blocks save and shows an error for an invalid email', async () => {
    const { onReceipt } = renderBid(closedStore(12));
    fireEvent.change(await screen.findByLabelText(t('win.email')), {
      target: { value: 'not-an-email' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('win.save') }));
    expect(screen.getByText(t('win.emailError'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t('win.receipt') }));
    expect(onReceipt).not.toHaveBeenCalled();
    expect(savedRecords()).toHaveLength(0);
  });

  it('writes valid details to local storage and then runs the action', async () => {
    const { onReceipt } = renderBid(closedStore(12));
    fireEvent.change(await screen.findByLabelText(t('win.email')), {
      target: { value: 'ana@example.com' },
    });
    fireEvent.change(screen.getByLabelText(t('win.phone')), {
      target: { value: '+1 555-010-2030' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('win.receipt') }));
    expect(onReceipt).toHaveBeenCalledTimes(1);
    const rec = savedRecords();
    expect(rec).toHaveLength(1);
    expect(rec[0]?.email).toBe('ana@example.com');
    expect(rec[0]?.phone).toBe('+1 555-010-2030');
    expect(typeof rec[0]?.savedAt).toBe('number');
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
