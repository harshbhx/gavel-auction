import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { en } from '../../src/copy/en';
import { t } from '../../src/copy/t';
import { BidScreen } from '../../src/screens/bid/BidScreen';
import { CustomBid, customReason } from '../../src/screens/bid/CustomBid';
import { RegisterScreen } from '../../src/screens/register/RegisterScreen';
import { ceilingRange } from '../../src/screens/register/validate';
import { RoomStore } from '../../src/store/roomStore';
import { baseConfig, bidderId, openSnapshot, roster, stateMsg } from '../../src/testing/builders';
import { confirmHold } from '../support/approveHold';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ceilingRange: min and max come from the room and the server cap', () => {
  it('uses the server cap and the reserve rounded up to whole dollars', () => {
    expect(ceilingRange(1050, 250_000, [5_000])).toEqual({ minCents: 1100, maxCents: 250_000 });
  });

  it('never goes under one dollar or over the cap, and floors a cap that is not whole dollars', () => {
    expect(ceilingRange(0, 25_050, undefined)).toEqual({ minCents: 100, maxCents: 25_000 });
    expect(ceilingRange(900_000, 5_000, undefined)).toEqual({ minCents: 5_000, maxCents: 5_000 });
  });

  it('falls back to the largest preset when an older server sends no cap', () => {
    expect(ceilingRange(1000, undefined, [2_000, 5_000])).toEqual({
      minCents: 1000,
      maxCents: 5_000,
    });
  });
});

function toCeilingStep(onApprove = vi.fn()) {
  render(
    <RegisterScreen
      minCents={1000}
      maxCents={250_000}
      presetsCents={[2_000, 5_000]}
      onApprove={onApprove}
    />,
  );
  fireEvent.change(screen.getByLabelText(t('reg.name')), { target: { value: 'Priya' } });
  fireEvent.click(screen.getByRole('button', { name: t('reg.continue') }));
  return { onApprove, field: screen.getByRole('textbox', { name: t('reg.custom') }) };
}

describe('custom ceiling at registration', () => {
  it('sits next to the presets and shows the allowed range', () => {
    toCeilingStep();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.getByText(t('reg.customHint', { min: '$10', max: '$2,500' }))).toBeTruthy();
  });

  it('keeps digits only and sends the typed whole-dollar amount in cents', () => {
    const { onApprove, field } = toCeilingStep();
    fireEvent.change(field, { target: { value: '$1,2a5.0' } });
    expect((field as HTMLInputElement).value).toBe('1,250');
    expect(field.getAttribute('inputmode')).toBe('numeric');
    expect(screen.getByTestId('held-block').textContent).toContain(t('reg.heldNotCharged'));
    confirmHold();
    expect(onApprove).toHaveBeenCalledWith({ name: 'Priya', ceilingCents: 125_000 });
  });

  it('refuses more than the server maximum and less than the minimum, with the range as text', () => {
    const { onApprove, field } = toCeilingStep();
    for (const [typed, message] of [
      ['2501', t('reg.overCap', { max: '$2,500' })],
      ['9', t('reg.customRange', { min: '$10', max: '$2,500' })],
    ] as const) {
      fireEvent.change(field, { target: { value: typed } });
      fireEvent.blur(field);
      expect(screen.getByRole('alert').textContent).toContain(message);
      expect(screen.queryByTestId('held-block')).toBeNull();
      expect(
        screen.getByRole('button', { name: t('reg.approve') }).getAttribute('aria-disabled'),
      ).toBe('true');
    }
    expect(onApprove).not.toHaveBeenCalled();
  });

  it('still takes a preset with one tap', () => {
    const onApprove = vi.fn();
    render(
      <RegisterScreen
        minCents={1000}
        maxCents={250_000}
        presetsCents={[2_000, 5_000]}
        onApprove={onApprove}
      />,
    );
    fireEvent.change(screen.getByLabelText(t('reg.name')), { target: { value: 'Priya' } });
    fireEvent.click(screen.getByRole('button', { name: t('reg.continue') }));
    fireEvent.click(screen.getByLabelText('$50'));
    confirmHold();
    expect(onApprove).toHaveBeenCalledWith({ name: 'Priya', ceilingCents: 5_000 });
  });
});

describe('Place bid always answers', () => {
  const place = (): HTMLElement => screen.getByRole('button', { name: t('bid.place') });

  it('is never a dead button and says why an empty or unreadable amount is not sent', () => {
    const send = vi.fn();
    render(<CustomBid nextMinCents={5_500} ceilingCents={10_000} onBid={send} />);
    expect(place().getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(place());
    expect(screen.getByRole('alert').textContent).toContain(
      t('bid.enterAmount', { min: '$55.00' }),
    );
    const field = screen.getByLabelText(t('bid.custom'));
    fireEvent.change(field, { target: { value: 'fifty' } });
    fireEvent.click(place());
    expect(screen.getByRole('alert').textContent).toContain(t('bid.notAnAmount'));
    expect(send).not.toHaveBeenCalled();
  });

  it('says why an amount under the minimum or over the ceiling is not sent', () => {
    const send = vi.fn();
    render(<CustomBid nextMinCents={5_500} ceilingCents={10_000} onBid={send} />);
    const field = screen.getByLabelText(t('bid.custom'));
    fireEvent.change(field, { target: { value: '50' } });
    fireEvent.click(place());
    expect(screen.getByRole('alert').textContent).toContain(
      t('bid.rej.below_increment', { min: '$55.00' }),
    );
    fireEvent.change(field, { target: { value: '150' } });
    fireEvent.click(place());
    expect(screen.getByRole('alert').textContent).toContain(
      t('bid.rej.over_ceiling', { max: '$100' }),
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('sends a valid amount on the button and on Enter, clearing the earlier reason', () => {
    const send = vi.fn();
    render(<CustomBid nextMinCents={5_500} ceilingCents={10_000} onBid={send} />);
    fireEvent.click(place());
    expect(screen.queryByRole('alert')).not.toBeNull();
    const field = screen.getByLabelText(t('bid.custom'));
    fireEvent.change(field, { target: { value: '60' } });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(place());
    expect(send).toHaveBeenCalledWith(6_000);
    fireEvent.submit(field.closest('form') as HTMLFormElement);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('names a reason for every refusal and uses no banned wording', () => {
    const reasons = [
      customReason('', 5_500, 10_000),
      customReason('x', 5_500, 10_000),
      customReason('10', 5_500, 10_000),
      customReason('500', 5_500, 10_000),
    ];
    for (const r of reasons) expect(r ?? '').not.toBe('');
    expect(customReason('60', 5_500, 10_000)).toBeUndefined();
    for (const key of [
      'bid.enterAmount',
      'bid.notAnAmount',
      'bid.watchingOnly',
      'bid.notConnected',
      'bid.atCeiling',
      'bid.sentWaiting',
      'bid.notOpenYet',
      'reg.customHint',
    ] as const) {
      expect(en[key], key).not.toMatch(/\b(pay|paid|payment|capture|captured|charged|first)\b/i);
    }
  });
});

function storeFor(opts: {
  ceiling?: number;
  status?: 'OPEN' | 'SCHEDULED';
  watching?: boolean;
}): RoomStore {
  const store = new RoomStore();
  const base = openSnapshot(roster([12, 'Priya'], [7, 'Sam']), baseConfig, opts.status ?? 'OPEN');
  const snap =
    opts.watching === true
      ? base
      : { ...base, you: { bidderId: bidderId(12), ceiling: opts.ceiling ?? 100_000 } };
  store.dispatch({ kind: 'wire', msg: stateMsg(1, snap as never) }, 0);
  return store;
}

describe('the bid screen explains a missing or limited bid bar', () => {
  it('tells a watcher they cannot bid instead of showing nothing', () => {
    render(<BidScreen store={storeFor({ watching: true })} onBid={() => undefined} />);
    expect(screen.getByTestId('bid-blocked').textContent).toBe(t('bid.watchingOnly'));
    expect(screen.queryByTestId('bid-bar')).toBeNull();
  });

  it('tells a bidder the room is not connected yet', () => {
    render(<BidScreen store={storeFor({})} canSend={false} onBid={() => undefined} />);
    expect(screen.getByTestId('bid-blocked').textContent).toBe(t('bid.notConnected'));
  });

  it('says bidding has not opened yet for a scheduled lot', () => {
    render(<BidScreen store={storeFor({ status: 'SCHEDULED' })} onBid={() => undefined} />);
    expect(screen.getByText(t('bid.notOpenYet'))).toBeTruthy();
  });

  it('explains that the ceiling is reached when the next bid is above it', () => {
    render(<BidScreen store={storeFor({ ceiling: 4_000 })} onBid={() => undefined} />);
    expect(screen.getByTestId('bid-at-ceiling').textContent).toBe(
      t('bid.atCeiling', { min: '$50.00', max: '$40' }),
    );
  });

  it('says the bid was sent while it waits for the room', () => {
    render(<BidScreen store={storeFor({})} pending onBid={() => undefined} />);
    expect(screen.getByTestId('bid-sent').textContent).toBe(t('bid.sentWaiting'));
  });

  it('shows the server refusal for a bid above the ceiling and for leading twice', () => {
    const { rerender } = render(
      <BidScreen
        store={storeFor({ ceiling: 5_000 })}
        rejection={{ reason: 'over_ceiling', mid: 'm1' }}
        onBid={() => undefined}
      />,
    );
    expect(screen.getByRole('alert').textContent).toBe(t('bid.rej.over_ceiling', { max: '$50' }));
    rerender(
      <BidScreen
        store={storeFor({ ceiling: 5_000 })}
        rejection={{ reason: 'already_leading', mid: 'm2' }}
        onBid={() => undefined}
      />,
    );
    expect(screen.getByRole('alert').textContent).toBe(t('bid.rej.already_leading'));
  });
});
