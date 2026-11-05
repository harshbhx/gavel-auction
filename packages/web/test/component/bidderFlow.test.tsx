import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../src/copy/t';
import { ConfirmSheet } from '../../src/screens/bid/ConfirmSheet';
import { CustomBid } from '../../src/screens/bid/CustomBid';
import { QuickBid, useSendGuard } from '../../src/screens/bid/QuickBid';
import { Rejection } from '../../src/screens/bid/Rejection';
import { StateBanner, bidsLocked } from '../../src/screens/bid/StateBanner';
import { VIBRATE_KEY, useOutbid } from '../../src/screens/bid/useOutbid';
import { Approve } from '../../src/screens/register/Approve';
import type { ConfirmRequestMsg } from '../../src/wire';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  globalThis.sessionStorage.clear();
});

const noop = (): void => undefined;

function Guarded({ send }: { send: (c: number) => void }) {
  const guarded = useSendGuard(send, false);
  return <QuickBid nextMinCents={5000} incrementCents={500} ceilingCents={5200} onBid={guarded} />;
}

describe('QuickBid and CustomBid (T-WEB-033)', () => {
  it('disables buttons above the ceiling with text and sends one bid on a double tap', () => {
    vi.useFakeTimers();
    const send = vi.fn();
    render(<Guarded send={send} />);
    const first = screen.getByRole('button', { name: t('bid.quick', { amount: '$50' }) });
    fireEvent.click(first);
    fireEvent.click(first);
    expect(send).toHaveBeenCalledTimes(1);
    const over = screen.getByRole('button', { name: t('bid.quick', { amount: '$55' }) });
    expect(over.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText(t('bid.aboveCeiling'))).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(600);
    });
    fireEvent.click(first);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('sends a custom amount only on submit and hints on every keystroke', () => {
    const send = vi.fn();
    render(<CustomBid nextMinCents={5000} ceilingCents={10000} onBid={send} />);
    const input = screen.getByLabelText(t('bid.custom'));
    expect(input.getAttribute('inputmode')).toBe('numeric');
    fireEvent.change(input, { target: { value: '20' } });
    expect(screen.getByText(t('bid.rej.below_increment', { min: '$50.00' }))).toBeTruthy();
    fireEvent.change(input, { target: { value: '500' } });
    expect(screen.getByText(t('bid.aboveCeiling'))).toBeTruthy();
    fireEvent.change(input, { target: { value: '60' } });
    expect(send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: t('bid.place') }));
    expect(send).toHaveBeenCalledWith(6000);
  });
});

const closedRejection = { reason: 'closed' };

describe('Rejection and StateBanner (T-WEB-035)', () => {
  it('clears on a price change', () => {
    const { rerender } = render(
      <Rejection rejection={closedRejection} priceCents={5000} maxCents={null} minCents={5500} />,
    );
    expect(screen.getByRole('alert').textContent).toBe(t('bid.rej.closed'));
    rerender(
      <Rejection rejection={closedRejection} priceCents={5500} maxCents={null} minCents={6000} />,
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('explains paused, closed and stopped and locks the controls', () => {
    const { rerender } = render(<StateBanner status="PAUSED" />);
    expect(screen.getByText(t('bid.paused'))).toBeTruthy();
    rerender(<StateBanner status="CLOSING" />);
    expect(screen.getByText(t('bid.closedBanner'))).toBeTruthy();
    rerender(<StateBanner status="OPEN" stopped />);
    expect(screen.getByText(t('bid.stoppedBanner'))).toBeTruthy();
    expect(bidsLocked('PAUSED')).toBe(true);
    expect(bidsLocked('DONE')).toBe(true);
    expect(bidsLocked('OPEN', true)).toBe(true);
    expect(bidsLocked('OPEN')).toBe(false);
  });
});

function OutbidProbe({ status }: { status: string }) {
  const { vibrate, setVibrate } = useOutbid(status, 5000);
  return <button onClick={() => setVibrate(!vibrate)}>{String(vibrate)}</button>;
}

describe('useOutbid', () => {
  it('stays off by default and vibrates once when opted in', () => {
    const vibrate = vi.fn();
    Object.defineProperty(globalThis.navigator, 'vibrate', { value: vibrate, configurable: true });
    const { rerender } = render(<OutbidProbe status="leading" />);
    rerender(<OutbidProbe status="outbid" />);
    expect(vibrate).not.toHaveBeenCalled();
    rerender(<OutbidProbe status="leading" />);
    fireEvent.click(screen.getByRole('button'));
    expect(globalThis.sessionStorage.getItem(VIBRATE_KEY)).toBe('1');
    rerender(<OutbidProbe status="outbid" />);
    expect(vibrate).toHaveBeenCalledWith(60);
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it('does not fail when vibrate is unsupported', () => {
    Object.defineProperty(globalThis.navigator, 'vibrate', {
      value: undefined,
      configurable: true,
    });
    globalThis.sessionStorage.setItem(VIBRATE_KEY, '1');
    const { rerender } = render(<OutbidProbe status="leading" />);
    expect(() => rerender(<OutbidProbe status="outbid" />)).not.toThrow();
  });
});

const request = {
  v: 1,
  t: 'confirm_request',
  confirmId: 'c1',
  amount: 35000,
  expiresAt: 10_000,
} as unknown as ConfirmRequestMsg;

describe('ConfirmSheet (T-WEB-034)', () => {
  it('answers once and ignores a second tap', () => {
    const onRespond = vi.fn();
    render(
      <ConfirmSheet
        request={request}
        paddle={12}
        currentCents={35000}
        onRespond={onRespond}
        now={() => 0}
      />,
    );
    expect(screen.getAllByText(t('confirm.title', { amount: '$350.00', n: 12 })).length).toBe(1);
    const yes = screen.getByRole('button', { name: t('confirm.yes') });
    fireEvent.click(yes);
    fireEvent.click(yes);
    expect(onRespond).toHaveBeenCalledTimes(1);
    expect(onRespond).toHaveBeenCalledWith('c1', true);
    expect(screen.getByText(t('confirm.answered'))).toBeTruthy();
  });

  it('notes a price change and expires at expiresAt', () => {
    vi.useFakeTimers();
    let clock = 0;
    const onRespond = vi.fn();
    const { rerender } = render(
      <ConfirmSheet
        request={request}
        paddle={12}
        currentCents={35000}
        onRespond={onRespond}
        now={() => clock}
      />,
    );
    rerender(
      <ConfirmSheet
        request={request}
        paddle={12}
        currentCents={40000}
        onRespond={onRespond}
        now={() => clock}
      />,
    );
    expect(screen.getByText(t('confirm.changed', { amount: '$400.00' }))).toBeTruthy();
    clock = 10_000;
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByText(t('confirm.expired'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t('confirm.yes') }));
    expect(onRespond).not.toHaveBeenCalled();
  });
});

describe('Approve (T-WEB-023)', () => {
  const base = { ceilingCents: 50000, onBackToCeiling: noop, onRetry: noop, onContinue: noop };

  it('cancelled shows the message and goes back to the ceiling step', () => {
    const back = vi.fn();
    render(<Approve {...base} state="cancelled" result={null} onBackToCeiling={back} />);
    expect(screen.getByText(t('reg.cancelled'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t('generic.back') }));
    expect(back).toHaveBeenCalled();
  });

  it('held shows the suffix, the full id in a disclosure and Continue', () => {
    const cont = vi.fn();
    render(
      <Approve
        {...base}
        state="held"
        result={{ state: 'held', holdId: 'HOLD-ABC123456', ceilingCents: 50000 }}
        onContinue={cont}
      />,
    );
    expect(screen.getByText(t('reg.heldRef', { suffix: '123456' }))).toBeTruthy();
    expect(screen.getByText('HOLD-ABC123456')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t('reg.continue') }));
    expect(cont).toHaveBeenCalled();
  });

  it('shows popup blocked, stale token and closed messages', () => {
    const { rerender } = render(
      <Approve {...base} state="error" result={{ state: 'error', errorCode: 'popup_blocked' }} />,
    );
    expect(screen.getByText(t('reg.popupBlocked'))).toBeTruthy();
    rerender(
      <Approve {...base} state="error" result={{ state: 'error', errorCode: 'order_mismatch' }} />,
    );
    expect(screen.getByText(t('reg.expired'))).toBeTruthy();
    rerender(<Approve {...base} state="idle" result={null} closed watchHref="/watch" />);
    expect(screen.getByText(t('reg.closed'))).toBeTruthy();
    expect(screen.getByText(t('reg.watch')).getAttribute('href')).toBe('/watch');
  });
});
