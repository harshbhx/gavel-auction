import type { AuctionId } from '@gavel/shared';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../src/copy/t';
import { BidScreen } from '../../src/screens/bid/BidScreen';
import { KillSwitch } from '../../src/screens/console/KillSwitch';
import { PriceHeader } from '../../src/screens/console/PriceHeader';
import { JudgeHub } from '../../src/screens/hub/JudgeHub';
import { ScreenView } from '../../src/screens/screen/ScreenView';
import { RoomStore } from '../../src/store/roomStore';
import { selectors } from '../../src/store/selectors';
import {
  baseConfig,
  bidderId,
  openSnapshot,
  priceMsg,
  roster,
  stateMsg,
} from '../../src/testing/builders';

const ROOM = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

function hammer(winner: number | null, seq: number, stopped: boolean): unknown {
  return {
    v: 1,
    t: 'hammer',
    seq,
    ts: 1,
    winnerId: winner === null ? null : bidderId(winner),
    price: 40_000,
    ranking: [],
    ...(stopped ? { stopped: true } : {}),
  };
}

function openStore(): RoomStore {
  const store = new RoomStore();
  store.dispatch({
    kind: 'wire',
    msg: stateMsg(1, openSnapshot(roster([12, 'Priya']), baseConfig, 'OPEN', ROOM as AuctionId)),
  });
  store.dispatch({ kind: 'wire', msg: priceMsg(2, 12, 40_000) });
  return store;
}

function stop(store: RoomStore): void {
  act(() => {
    store.dispatch({ kind: 'wire', msg: hammer(null, 3, true) as never });
  });
}

describe('stop auction hold control (console)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('shows the hold ring and stops only after a full hold', () => {
    const onKill = vi.fn();
    render(<KillSwitch stopped={false} onKill={onKill} />);
    const hold = screen.getByRole('button', { name: new RegExp(t('kill.deskHold')) });
    expect(hold.getAttribute('data-tone')).toBe('danger');
    expect(hold.querySelector('.ui-hold__ring')).not.toBeNull();
    fireEvent.pointerDown(hold, { button: 0 });
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(hold.getAttribute('data-phase')).toBe('holding');
    fireEvent.pointerUp(hold);
    act(() => {
      vi.advanceTimersByTime(3500);
    });
    expect(onKill).not.toHaveBeenCalled();
    fireEvent.pointerDown(hold, { button: 0 });
    act(() => {
      vi.advanceTimersByTime(3100);
    });
    expect(onKill).toHaveBeenCalledTimes(1);
  });

  it('works from the keyboard and keeps the dialog fallback', () => {
    const onKill = vi.fn();
    render(<KillSwitch stopped={false} onKill={onKill} />);
    const hold = screen.getByRole('button', { name: new RegExp(t('kill.deskHold')) });
    fireEvent.keyDown(hold, { key: 'Enter' });
    act(() => {
      vi.advanceTimersByTime(3100);
    });
    expect(onKill).toHaveBeenCalledTimes(1);
    expect(screen.getByText(t('kill.dialogHint'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t('kill.button') }));
    expect(screen.getByLabelText(t('kill.type'))).toBeTruthy();
  });

  it('still completes under reduced motion', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    const onKill = vi.fn();
    render(<KillSwitch stopped={false} onKill={onKill} />);
    const hold = screen.getByRole('button', { name: new RegExp(t('kill.deskHold')) });
    fireEvent.pointerDown(hold, { button: 0 });
    act(() => {
      vi.advanceTimersByTime(3100);
    });
    vi.unstubAllGlobals();
    expect(onKill).toHaveBeenCalledTimes(1);
  });
});

describe('stopped clock on every surface', () => {
  afterEach(cleanup);

  it('console: the countdown reads Stopped', () => {
    const props = {
      priceCents: 40_000,
      reserveCents: 10_000,
      leaderPaddle: 12,
      leaderName: 'Priya',
      bidCount: 1,
      endTs: 60_000,
      now: () => 0,
      nextMinCents: 41_000,
    };
    const { rerender } = render(<PriceHeader {...props} />);
    expect(screen.queryByText(t('console.clockStopped'))).toBeNull();
    rerender(<PriceHeader {...props} stopped />);
    expect(screen.getByText(t('console.clockStopped'))).toBeTruthy();
  });

  it('screen: a stopped snapshot replaces the running clock with Stopped', () => {
    const store = openStore();
    render(<ScreenView lotTitle="Lot" code="C" joinUrl="https://x.test/j" store={store} />);
    expect(document.querySelector('.gv-screen__clock')?.textContent).not.toBe(
      t('screen.clockStopped'),
    );
    act(() => {
      store.dispatch({
        kind: 'wire',
        msg: stateMsg(4, {
          ...openSnapshot(roster([12, 'Priya']), baseConfig, 'OPEN', ROOM as AuctionId),
          stopped: true,
        }),
      });
    });
    expect(document.querySelector('.gv-screen__clock')?.textContent).toBe(t('screen.clockStopped'));
    expect(screen.getAllByText(t('screen.stopped')).length).toBeGreaterThan(0);
  });

  it('bid: a stopped hammer frame counts as stopped and the page says so', () => {
    const store = openStore();
    stop(store);
    expect(selectors.stopped(store.getState())).toBe(true);
    render(<BidScreen store={store} onBid={() => undefined} stopped />);
    expect(screen.getAllByText(t('bid.stoppedBanner')).length).toBeGreaterThan(0);
  });

  it('keeps a sale a sale: a winner means not stopped', () => {
    const store = openStore();
    act(() => {
      store.dispatch({ kind: 'wire', msg: hammer(12, 3, true) as never });
    });
    expect(selectors.stopped(store.getState())).toBe(false);
  });
});

describe('room hub follows the stop at once', () => {
  class FakeSocket {
    static last: FakeSocket | null = null;
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onmessage: ((ev: { data: unknown }) => void) | null = null;
    readyState = 1;
    constructor() {
      FakeSocket.last = this;
    }
    send(): void {
      // Nothing to send.
    }
    close(): void {
      // Nothing to release.
    }
  }
  const deliver = (msg: unknown): void =>
    act(() => {
      FakeSocket.last?.onmessage?.({ data: JSON.stringify(msg) });
    });

  beforeEach(() => {
    FakeSocket.last = null;
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) })),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function mount(): void {
    render(
      <JudgeHub
        roomId={ROOM}
        keys={{ auctioneer: 'c-tok', screen: 's-tok', expiresAt: null, code: 'EMY48N' }}
        apiBase="http://api.test"
        origin="https://web.test"
      />,
    );
    act(() => {
      FakeSocket.last?.onopen?.();
    });
    deliver(
      stateMsg(1, openSnapshot(roster([12, 'Priya']), baseConfig, 'OPEN', ROOM as AuctionId)),
    );
  }

  it('shows Auction stopped and closes the join actions without a reload', () => {
    mount();
    expect(screen.getByTestId('hub-join-open').tagName).toBe('A');
    expect(screen.queryByTestId('hub-ended')).toBeNull();
    deliver(hammer(null, 2, true));
    expect(screen.getAllByText(t('hub.stopped')).length).toBeGreaterThan(0);
    expect(screen.getByTestId('hub-ended').textContent).toBe(t('hub.stoppedNote'));
    expect(screen.getByTestId('hub-join-open').tagName).not.toBe('A');
    expect(screen.queryByRole('button', { name: t('hub.newInvite') })).toBeNull();
    expect(
      screen.getByRole('button', { name: t('hub.copyInvite') }).getAttribute('aria-disabled'),
    ).toBe('true');
  });

  it('closes joining after a hammer with a winner, without calling it stopped', () => {
    mount();
    deliver(hammer(12, 2, false));
    expect(screen.getByTestId('hub-ended').textContent).toBe(t('hub.closedNote'));
    expect(screen.queryByText(t('hub.stoppedNote'))).toBeNull();
  });
});
