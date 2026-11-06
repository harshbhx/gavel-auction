import { act, render, screen } from '@testing-library/react';
import { Cents, EpochMs } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { ReceiptRoute } from '../../src/App';
import { t } from '../../src/copy/t';
import { roomStore } from '../../src/store/roomStore';
import { BASE_TIME, bidderId, openSnapshot, roster, stateMsg } from '../../src/testing/builders';
import type { SettlementUpdateMsg } from '../../src/wire';

function update(seq: number, state: 'VOIDING' | 'SETTLED'): SettlementUpdateMsg {
  return {
    v: 1,
    t: 'settlement_update',
    seq,
    ts: EpochMs(BASE_TIME + seq),
    rev: seq,
    auctionState: state,
    you: state,
    winnerPaddle: 1,
    holds: [
      {
        paddle: 1,
        state: 'CAPTURED',
        capturedCents: 35000,
        releasedCents: 15000,
        idSuffix: 'AB12CD',
        verifiedBy: [],
      },
      {
        paddle: 2,
        state,
        capturedCents: 0,
        releasedCents: state === 'SETTLED' ? 30000 : 0,
        idSuffix: 'EF34GH',
        verifiedBy: [],
      },
    ],
    invariants: { ok: true, violations: [] },
  };
}

describe('receipt route from per-hold settlement data', () => {
  it('says releasing, then released, for a bidder who did not win', () => {
    const snap = {
      ...openSnapshot(roster([1, 'Ana'], [2, 'Ben'])),
      you: { bidderId: bidderId(2), ceiling: Cents(30000) },
      settlement: { rev: 1, auctionState: 'VOIDING' as const, you: 'VOIDING' as const },
    };
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
    act(() => roomStore.dispatch({ kind: 'wire', msg: update(3, 'VOIDING') }));
    const { container } = render(<ReceiptRoute roomId="lot1" />);
    expect(screen.getByText('Releasing your hold')).toBeTruthy();
    expect(container.textContent).not.toMatch(/hold was released/);
    expect(container.textContent).not.toMatch(/Charged/);
    act(() => roomStore.dispatch({ kind: 'wire', msg: update(4, 'SETTLED') }));
    expect(container.textContent).toMatch(/hold was released/);
  });
});

describe('receipt route after a stop (#537)', () => {
  it('says the auction was stopped when the snapshot carries the flag', () => {
    const snap = {
      ...openSnapshot(roster([1, 'Ana'], [2, 'Ben'])),
      you: { bidderId: bidderId(2), ceiling: Cents(30000) },
      stopped: true,
    };
    act(() => roomStore.dispatch({ kind: 'wire', msg: stateMsg(1, snap) }));
    render(<ReceiptRoute roomId="room-stop" />);
    expect(screen.getByText(t('screen.stopped'))).toBeTruthy();
  });
});
