import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../src/copy/t';
import { BidScreen } from '../../src/screens/bid/BidScreen';
import { CeilingMeter } from '../../src/screens/bid/CeilingMeter';
import { StatusChip, myStatus } from '../../src/screens/bid/StatusChip';
import { RoomStore } from '../../src/store/roomStore';
import { bidderId, openSnapshot, priceMsg, roster, stateMsg } from '../../src/testing/builders';

function makeStore(ceiling: number): RoomStore {
  const store = new RoomStore();
  const snap = {
    ...openSnapshot(roster([12, 'Priya'], [7, 'Sam'])),
    you: { bidderId: bidderId(12), ceiling },
  };
  store.dispatch({ kind: 'wire', msg: stateMsg(1, snap as never) }, 0);
  return store;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('myStatus', () => {
  it('turns pending on only while undecided', () => {
    expect(myStatus('none', true)).toBe('pending');
    expect(myStatus('outbid', true)).toBe('pending');
    expect(myStatus('won', true)).toBe('won');
    expect(myStatus('leading', false)).toBe('leading');
  });
});

describe('StatusChip', () => {
  it('renders text for every value', () => {
    const all = [
      'leading',
      'outbid',
      'none',
      'pending',
      'atCeiling',
      'won',
      'lost',
      'watching',
    ] as const;
    for (const status of all) {
      const { container, unmount } = render(<StatusChip status={status} />);
      const chip = container.querySelector('[data-state]');
      expect(chip?.getAttribute('data-state')).toBe(status);
      expect((chip?.textContent ?? '').length).toBeGreaterThan(0);
      expect(chip?.querySelector('svg')).not.toBeNull();
      unmount();
    }
  });
});

describe('CeilingMeter', () => {
  it('exposes meter values and text', () => {
    render(<CeilingMeter usedCents={15000} maxCents={50000} />);
    const meter = screen.getByRole('meter');
    expect(meter.getAttribute('aria-valuenow')).toBe('15000');
    expect(meter.getAttribute('aria-valuemin')).toBe('0');
    expect(meter.getAttribute('aria-valuemax')).toBe('50000');
    expect(screen.getAllByText(t('bid.ceilingMeter', { used: '$150', max: '$500' })).length).toBe(
      1,
    );
  });
});

describe('BidScreen (T-WEB-033)', () => {
  it('shows the opening price, a not bidding chip and sends one bid on a double tap', () => {
    vi.useFakeTimers();
    const onBid = vi.fn();
    render(<BidScreen store={makeStore(50000)} onBid={onBid} />);
    expect(screen.getByText('$1.00')).toBeTruthy();
    expect(screen.getByText(t('bid.status.none'))).toBeTruthy();
    const quick = screen.getByRole('button', { name: t('bid.quick', { amount: '$50' }) });
    fireEvent.click(quick);
    fireEvent.click(quick);
    expect(onBid).toHaveBeenCalledTimes(1);
    expect(onBid).toHaveBeenCalledWith(5000);
  });

  it('disables bids above the ceiling', () => {
    render(<BidScreen store={makeStore(6000)} onBid={() => undefined} />);
    const above = screen.getByRole('button', { name: t('bid.quick', { amount: '$100' }) });
    expect(above.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText(t('bid.aboveCeiling'))).toBeTruthy();
  });

  it('shows the leading chip after a price update for this bidder', () => {
    const store = makeStore(50000);
    act(() => {
      store.dispatch({ kind: 'wire', msg: priceMsg(2, 12, 5000) }, 0);
    });
    render(<BidScreen store={store} onBid={() => undefined} />);
    expect(screen.getByText(t('bid.status.leading'))).toBeTruthy();
  });

  it('shows a rejection and clears it after 6000 ms', () => {
    vi.useFakeTimers();
    render(
      <BidScreen
        store={makeStore(50000)}
        onBid={() => undefined}
        rejection={{ reason: 'below_increment' }}
      />,
    );
    expect(screen.getByRole('alert').textContent).toBe(
      t('bid.rej.below_increment', { min: '$50.00' }),
    );
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('BidScreen confirm sheet clock', () => {
  it('uses server time, so a fast phone clock does not expire the question', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const store = new RoomStore();
    const snap = {
      ...openSnapshot(roster([12, 'Priya'])),
      you: { bidderId: bidderId(12), ceiling: 50000 },
    };
    // The server reads 20 s behind this phone.
    store.dispatch({ kind: 'wire', msg: stateMsg(1, snap as never, 980_000) }, 1_000_000);
    store.dispatch(
      {
        kind: 'wire',
        msg: {
          v: 1,
          t: 'confirm_request',
          seq: 2,
          ts: 980_000,
          confirmId: 'c-clock',
          amount: 35000,
          expiresAt: 990_000,
        } as never,
      },
      1_000_000,
    );
    render(<BidScreen store={store} onBid={vi.fn()} myPaddle={12} onConfirm={vi.fn()} />);
    const yes = screen.getByRole('button', { name: t('confirm.yes') });
    expect(yes.getAttribute('aria-disabled')).not.toBe('true');
    expect(screen.queryByText(t('confirm.expired'))).toBeNull();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByText(t('confirm.expired'))).toBeTruthy();
  });
});
