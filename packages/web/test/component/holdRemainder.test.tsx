import { act, fireEvent, render, screen } from '@testing-library/react';
import { Cents, EpochMs } from '@gavel/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReceiptRoute } from '../../src/App';
import { t } from '../../src/copy/t';
import { ConsoleScreen } from '../../src/screens/console/ConsoleScreen';
import { RegisterScreen } from '../../src/screens/register/RegisterScreen';
import { RoomStore, roomStore } from '../../src/store/roomStore';
import { BASE_TIME, bidderId, openSnapshot, roster, stateMsg } from '../../src/testing/builders';
import type { RemainderState, SettlementUpdateMsg } from '../../src/wire';

const REMAINDERS: readonly RemainderState[] = ['none', 'pending', 'released', 'unreleased'];

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

function settle(me: number, remainder: RemainderState | null): void {
  const msg: SettlementUpdateMsg = {
    v: 1,
    t: 'settlement_update',
    seq: 3,
    ts: EpochMs(BASE_TIME + 3000),
    rev: 3,
    auctionState: 'CAPTURED',
    you: 'CAPTURED',
    amountCaptured: Cents(35000),
    ...(remainder === null
      ? {}
      : {
          yourHold: {
            bidderId: bidderId(me),
            idSuffix: 'abc123',
            status: 'CAPTURED',
            ceilingCents: Cents(50000),
            capturedCents: 35000,
            releasedCents: remainder === 'released' ? 15000 : 0,
            remainder,
          },
        }),
  };
  act(() => roomStore.dispatch({ kind: 'wire', msg }));
}

const RELEASED_TEXT = t('hold.remainder.released');

describe('receipt route remainder state', () => {
  beforeEach(() => setup(1));

  it.each(REMAINDERS)('shows the %s wording on the receipt and on the ladder row', (value) => {
    settle(1, value);
    const { container } = render(<ReceiptRoute roomId="lot1" />);
    const receipt = container.querySelector('article.gv-receipt')?.textContent ?? '';
    const lane = container.querySelector('.gv-ladder__lane')?.textContent ?? '';
    const want = t(`hold.remainder.${value}`);
    expect(receipt).toContain(want);
    expect(lane).toContain(want);
    for (const other of REMAINDERS.filter((v) => v !== value)) {
      expect(receipt).not.toContain(t(`hold.remainder.${other}`));
    }
  });

  it('never says released before the server says released', () => {
    for (const value of ['none', 'pending', 'unreleased'] as const) {
      settle(1, value);
      const { container, unmount } = render(<ReceiptRoute roomId="lot1" />);
      expect(container.textContent).not.toContain(RELEASED_TEXT);
      unmount();
    }
  });

  it('shows no remainder line when the server sent none', () => {
    settle(1, null);
    const { container } = render(<ReceiptRoute roomId="lot1" />);
    expect(container.querySelector('[data-remainder]')).toBeNull();
  });
});

describe('fake payments label', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('shows on the receipt when the build uses fake payments', () => {
    vi.stubEnv('VITE_PAYMENTS', 'fake');
    setup(1);
    settle(1, 'none');
    render(<ReceiptRoute roomId="lot1" />);
    expect(screen.getByTestId('fake-payments-label').textContent).toContain(
      t('banner.fakePayments'),
    );
  });

  it('is absent on the receipt for the PayPal sandbox build', () => {
    vi.stubEnv('VITE_PAYMENTS', 'paypal');
    setup(1);
    settle(1, 'none');
    render(<ReceiptRoute roomId="lot1" />);
    expect(screen.queryByTestId('fake-payments-label')).toBeNull();
  });

  it('shows on the register approve step', () => {
    vi.stubEnv('VITE_PAYMENTS', 'fake');
    render(<RegisterScreen minCents={10000} maxCents={100000} onApprove={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(t('reg.name')), { target: { value: 'Priya' } });
    fireEvent.click(screen.getByRole('button', { name: t('reg.continue') }));
    expect(screen.getByTestId('fake-payments-label')).toBeTruthy();
  });

  it('shows in the console header', () => {
    vi.stubEnv('VITE_PAYMENTS', 'fake');
    const store = new RoomStore();
    store.dispatch({ kind: 'wire', msg: stateMsg(1, openSnapshot(roster([12, 'Priya']))) }, 0);
    render(<ConsoleScreen store={store} settlementView={null} wide />);
    expect(screen.getByTestId('fake-payments-label')).toBeTruthy();
  });
});
