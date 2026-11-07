import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Cents, EpochMs } from '@gavel/shared';
import { ScreenView } from '../../src/screens/screen/ScreenView';
import { RoomStore } from '../../src/store/roomStore';
import { BASE_TIME, bidderId, openSnapshot, roster, stateMsg } from '../../src/testing/builders';

type Frame = Parameters<RoomStore['dispatch']>[0];

function hold(paddle: number, capturedCents: number) {
  return {
    paddle,
    state: capturedCents > 0 ? 'CAPTURED' : 'WINNER_SELECTED',
    capturedCents,
    releasedCents: 0,
    idSuffix: 'ab12',
    verifiedBy: [],
  };
}

function settle(seq: number, auctionState: string, holds: ReturnType<typeof hold>[]): Frame {
  return {
    kind: 'wire',
    msg: {
      v: 1,
      t: 'settlement_update',
      seq,
      ts: EpochMs(BASE_TIME + seq),
      rev: seq,
      auctionState,
      winnerPaddle: 7,
      holds,
      invariants: { ok: true, violations: [] },
    },
  } as Frame;
}

function storeWith(goalCents: number | null): RoomStore {
  const store = new RoomStore();
  const snap = {
    ...openSnapshot(roster([7, 'Eve']), undefined, 'SETTLING'),
    price: Cents(40_000),
    leaderId: bidderId(7),
    ...(goalCents === null ? {} : { fundraiser: { goalCents: Cents(goalCents) } }),
  };
  store.dispatch({ kind: 'wire', msg: stateMsg(5, snap) });
  return store;
}

function view(store: RoomStore) {
  return render(<ScreenView lotTitle="Lot" code={null} joinUrl="https://x.test/j" store={store} />);
}

describe('fundraiser thermometer on the projector screen', () => {
  it('is hidden when the auctioneer set no goal', () => {
    const store = storeWith(null);
    store.dispatch(settle(6, 'CAPTURED', [hold(7, 40_000)]));
    view(store);
    expect(screen.queryByText(/Raised/)).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('shows held money as on hold, not as raised', () => {
    const store = storeWith(100_000);
    store.dispatch(settle(6, 'CAPTURING', [hold(7, 0)]));
    view(store);
    expect(screen.getByText('Raised $0.00 of $1,000.00')).toBeTruthy();
    expect(screen.getByText('On hold: $400.00')).toBeTruthy();
  });

  it('reads the captured total a screen receives on the wire (no per-hold detail)', () => {
    const store = storeWith(100_000);
    store.dispatch({
      kind: 'wire',
      msg: {
        v: 1,
        t: 'settlement_update',
        seq: 6,
        ts: EpochMs(BASE_TIME + 6),
        rev: 6,
        auctionState: 'CAPTURED',
        amountCaptured: Cents(40_000),
        winnerPaddle: 7,
      },
    } as Frame);
    view(store);
    expect(screen.getByText('Raised $400.00 of $1,000.00')).toBeTruthy();
    expect(screen.queryByText(/On hold/)).toBeNull();
  });

  it('moves the amount to raised once it is captured', () => {
    const store = storeWith(100_000);
    view(store);
    act(() => {
      store.dispatch(settle(6, 'CAPTURING', [hold(7, 0)]));
    });
    expect(screen.getByText('On hold: $400.00')).toBeTruthy();
    act(() => {
      store.dispatch(settle(7, 'CAPTURED', [hold(7, 40_000)]));
    });
    expect(screen.getByText('Raised $400.00 of $1,000.00')).toBeTruthy();
    expect(screen.queryByText(/On hold/)).toBeNull();
    const fill = document.querySelector<HTMLElement>('.gv-thermo__fill');
    expect(fill?.style.transform).toBe('scaleX(0.4)');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('40');
  });
});
