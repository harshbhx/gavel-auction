import { act, render, screen } from '@testing-library/react';
import { Cents, EpochMs } from '@gavel/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ReceiptRoute } from '../../src/App';
import { t } from '../../src/copy/t';
import { roomStore } from '../../src/store/roomStore';
import { BASE_TIME, bidderId, openSnapshot, roster, stateMsg } from '../../src/testing/builders';

function setup(me: number): void {
  const snap = {
    ...openSnapshot(roster([1, 'Ana'], [2, 'Ben'])),
    you: { bidderId: bidderId(me), ceiling: Cents(50000) },
  };
  act(() => roomStore.dispatch({ kind: 'reset' }));
  act(() => roomStore.dispatch({ kind: 'wire', msg: stateMsg(1, snap) }));
  act(() =>
    roomStore.dispatch({
      kind: 'wire',
      msg: {
        v: 1,
        t: 'hammer',
        seq: 2,
        ts: EpochMs(BASE_TIME + 2),
        winnerId: bidderId(1),
        price: Cents(35000),
        ranking: [],
      },
    }),
  );
}

function seed(): void {
  window.localStorage.setItem(
    'gavel:winner:lot1',
    JSON.stringify({ email: 'ana@example.com', phone: '+1 555-010-2030', savedAt: 1 }),
  );
}

beforeEach(() => window.localStorage.clear());
afterEach(() => window.localStorage.clear());

describe('winner details on the receipt', () => {
  it('shows paddle, email and phone to the winner when a record exists', () => {
    setup(1);
    seed();
    render(<ReceiptRoute roomId="lot1" />);
    const block = screen.getByTestId('winner-details');
    expect(block.textContent).toContain(t('receipt.winnerDetails'));
    expect(block.textContent).toContain('ana@example.com');
    expect(block.textContent).toContain('+1 555-010-2030');
  });

  it('shows nothing when no record exists', () => {
    setup(1);
    render(<ReceiptRoute roomId="lot1" />);
    expect(screen.queryByTestId('winner-details')).toBeNull();
  });

  it('shows nothing to a bidder who did not win, even with a record', () => {
    setup(2);
    seed();
    render(<ReceiptRoute roomId="lot1" />);
    expect(screen.queryByTestId('winner-details')).toBeNull();
  });
});
