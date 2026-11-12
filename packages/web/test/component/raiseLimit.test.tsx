import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { t } from '../../src/copy/t';
import type { ApprovalRequest, PaymentApprovalPort } from '../../src/payments/port';
import { resetApprovalMemory } from '../../src/payments/useApproval';
import { BidScreen } from '../../src/screens/bid/BidScreen';
import { minRaiseCents } from '../../src/screens/bid/RaiseLimit';
import { RoomStore } from '../../src/store/roomStore';
import { selectCeilingUsage } from '../../src/store/selectors';
import { baseConfig, bidderId, openSnapshot, roster, stateMsg } from '../../src/testing/builders';
import { confirmHold } from '../support/approveHold';

afterEach(() => {
  cleanup();
  resetApprovalMemory();
});

const ME = bidderId(12);

function storeFor(opts: { ceiling: number; cap?: number; watching?: boolean }): RoomStore {
  const store = new RoomStore();
  const base = openSnapshot(roster([12, 'Priya'], [7, 'Sam']), baseConfig, 'OPEN');
  const snap = {
    ...base,
    maxCeilingCents: opts.cap ?? 100_000,
    ...(opts.watching === true ? {} : { you: { bidderId: ME, ceiling: opts.ceiling } }),
  };
  store.dispatch({ kind: 'wire', msg: stateMsg(1, snap as never) }, 0);
  return store;
}

function heldPort(): { port: PaymentApprovalPort; starts: ApprovalRequest[] } {
  const starts: ApprovalRequest[] = [];
  const port: PaymentApprovalPort = {
    start: (req, on) => {
      starts.push(req);
      on('preparing');
      on('held');
      return Promise.resolve({
        state: 'held',
        holdId: 'hold-raise-1',
        ceilingCents: req.ceilingCents,
      });
    },
    cancel: () => undefined,
  };
  return { port, starts };
}

const raise = (port: PaymentApprovalPort) => ({ port, roomId: 'room-1', bidderId: ME });

describe('raising a limit from the bid screen (FEAT-61)', () => {
  it('offers the raise to a bidder and not to a watcher or without the wiring', () => {
    const { port } = heldPort();
    render(
      <BidScreen
        store={storeFor({ ceiling: 40_000 })}
        onBid={() => undefined}
        raise={raise(port)}
      />,
    );
    expect(screen.getByRole('button', { name: t('raise.cta') })).toBeTruthy();
    cleanup();
    render(<BidScreen store={storeFor({ ceiling: 40_000 })} onBid={() => undefined} />);
    expect(screen.queryByTestId('raise-limit')).toBeNull();
    cleanup();
    render(
      <BidScreen
        store={storeFor({ ceiling: 0, watching: true })}
        onBid={() => undefined}
        raise={raise(port)}
      />,
    );
    expect(screen.queryByTestId('raise-limit')).toBeNull();
  });

  it('does not offer a raise when the limit is already the server cap', () => {
    const { port } = heldPort();
    render(
      <BidScreen
        store={storeFor({ ceiling: 100_000, cap: 100_000 })}
        onBid={() => undefined}
        raise={raise(port)}
      />,
    );
    expect(screen.queryByTestId('raise-limit')).toBeNull();
  });

  it('says the next bid is above the limit and still offers the raise', () => {
    const { port } = heldPort();
    render(
      <BidScreen store={storeFor({ ceiling: 50 })} onBid={() => undefined} raise={raise(port)} />,
    );
    expect(screen.getByTestId('bid-at-ceiling').textContent).toContain('Raise your limit');
    expect(screen.getByRole('button', { name: t('raise.cta') })).toBeTruthy();
  });

  it('uses the register limit control, keeps the cap, and holds the typed limit with no name', async () => {
    const { port, starts } = heldPort();
    render(
      <BidScreen
        store={storeFor({ ceiling: 40_000 })}
        onBid={() => undefined}
        raise={raise(port)}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: t('raise.cta') }));

    expect(screen.getByText(t('raise.current', { amount: '$400' }))).toBeTruthy();
    const box = screen.getByRole('textbox', { name: t('reg.custom') }) as HTMLInputElement;
    const slider = screen.getByRole('slider');
    // The slider starts above the old limit; typing moves it, as on the register screen.
    expect(Number(slider.getAttribute('aria-valuemin'))).toBe(minRaiseCents(40_000));
    fireEvent.change(box, { target: { value: '750' } });
    expect(slider.getAttribute('aria-valuenow')).toBe('75000');

    // Above the real cap: the cap is named and nothing can be held.
    fireEvent.change(box, { target: { value: '1001' } });
    expect(screen.getByRole('alert').textContent).toContain(t('reg.overCap', { max: '$1,000' }));
    expect(screen.queryByTestId('held-block')).toBeNull();

    fireEvent.change(box, { target: { value: '750' } });
    expect(screen.getByTestId('held-block').textContent).toContain(t('reg.heldNotCharged'));
    expect(screen.getByText(t('raise.keepHold'))).toBeTruthy();
    confirmHold();

    await waitFor(() => expect(starts).toHaveLength(1));
    expect(starts[0]).toMatchObject({ roomId: 'room-1', bidderId: ME, ceilingCents: 75_000 });
    expect(starts[0]?.name).toBeUndefined();
    await waitFor(() => expect(screen.getByTestId('held-card').textContent).toContain('$750'));
    // Back to bidding.
    fireEvent.click(screen.getByRole('button', { name: t('reg.continue') }));
    expect(screen.getByTestId('bid-bar')).toBeTruthy();
  });

  it('raises past $1,000 on a room with a $100,000 cap and refuses past the cap (UIX-59)', async () => {
    const { port, starts } = heldPort();
    render(
      <BidScreen
        store={storeFor({ ceiling: 40_000, cap: 10_000_000 })}
        onBid={() => undefined}
        raise={raise(port)}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: t('raise.cta') }));
    const box = screen.getByRole('textbox', { name: t('reg.custom') }) as HTMLInputElement;
    const slider = screen.getByRole('slider');
    fireEvent.change(box, { target: { value: '25000' } });
    expect(slider.getAttribute('aria-valuemax')).toBe('10000000');
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.change(box, { target: { value: '100001' } });
    expect(screen.getByRole('alert').textContent).toContain(t('reg.overCap', { max: '$100,000' }));
    fireEvent.change(box, { target: { value: '25000' } });
    confirmHold();
    await waitFor(() => expect(starts).toHaveLength(1));
    expect(starts[0]).toMatchObject({ ceilingCents: 2_500_000 });
  });

  it('gives a raise from $15,000 a usable slider range with no typing', () => {
    const { port } = heldPort();
    render(
      <BidScreen
        store={storeFor({ ceiling: 1_500_000, cap: 10_000_000 })}
        onBid={() => undefined}
        raise={raise(port)}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: t('raise.cta') }));
    const slider = screen.getByRole('slider');
    expect(slider.getAttribute('aria-valuemin')).toBe(String(minRaiseCents(1_500_000)));
    expect(slider.getAttribute('aria-valuemax')).toBe('10000000');
    fireEvent.keyDown(slider, { key: 'End' });
    expect(slider.getAttribute('aria-valuenow')).toBe('10000000');
  });

  it('keeps the typed limit when the bidder goes back from the approval (#2394)', async () => {
    const port: PaymentApprovalPort = {
      start: (_req, on) => {
        on('declined');
        return Promise.resolve({ state: 'declined' });
      },
      cancel: () => undefined,
    };
    render(
      <BidScreen
        store={storeFor({ ceiling: 40_000 })}
        onBid={() => undefined}
        raise={raise(port)}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: t('raise.cta') }));
    const box = screen.getByRole('textbox', { name: t('reg.custom') }) as HTMLInputElement;
    fireEvent.change(box, { target: { value: '750' } });
    confirmHold();
    fireEvent.click(await screen.findByRole('button', { name: t('generic.back') }));
    const again = screen.getByRole('textbox', { name: t('reg.custom') }) as HTMLInputElement;
    expect(again.value).toBe('750');
    expect(screen.getByRole('slider').getAttribute('aria-valuenow')).toBe('75000');
    expect(screen.getByTestId('held-block').textContent).toContain('$750');
  });

  it('rejects a limit that is not higher than the current one', () => {
    const { port } = heldPort();
    render(
      <BidScreen
        store={storeFor({ ceiling: 40_000 })}
        onBid={() => undefined}
        raise={raise(port)}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: t('raise.cta') }));
    const box = screen.getByRole('textbox', { name: t('reg.custom') });
    fireEvent.change(box, { target: { value: '400' } });
    fireEvent.blur(box);
    expect(screen.getByRole('alert').textContent).toContain(
      t('reg.customRange', { min: '$401', max: '$1,000' }),
    );
    expect(screen.queryByTestId('held-block')).toBeNull();
  });

  it('shows the new limit once the room confirms it', () => {
    const store = storeFor({ ceiling: 40_000 });
    store.dispatch({ kind: 'identify', bidderId: ME as string }, 0);
    expect(selectCeilingUsage(store.getState())?.maxCents).toBe(40_000);
    act(() => {
      store.dispatch(
        {
          kind: 'wire',
          msg: {
            v: 1,
            t: 'registered',
            seq: 2,
            ts: 1_700_000_000_500,
            bidderId: ME,
            paddle: 12,
            ceiling: 75_000,
            role: 'bidder',
          } as never,
        },
        0,
      );
    });
    expect(selectCeilingUsage(store.getState())?.maxCents).toBe(75_000);
  });
});

describe('minRaiseCents', () => {
  it('is the next whole dollar above the limit', () => {
    expect(minRaiseCents(40_000)).toBe(40_100);
    expect(minRaiseCents(40_050)).toBe(40_100);
  });
});
