import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../src/copy/t';
import { HammerDialog } from '../../src/screens/console/HammerDialog';
import { HAMMER_HOLD_MS } from '../../src/screens/console/hammerHold';
import { KILL_HOLD_MS, KillSwitch } from '../../src/screens/console/KillSwitch';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function renderHammer(onConfirm: () => void) {
  render(
    <HammerDialog
      open
      leader={{ paddle: 7, name: 'Asha' }}
      priceCents={25_000}
      onConfirm={onConfirm}
      onCancel={vi.fn()}
    />,
  );
  return screen.getByRole('button', { name: t('console.hammerHold') });
}

describe('hold-to-confirm dialogs (3 seconds)', () => {
  it('hammer and stop both hold for 3 seconds', () => {
    expect(HAMMER_HOLD_MS).toBe(3000);
    expect(KILL_HOLD_MS).toBe(3000);
    expect(t('console.hammerHold')).toBe('Hold 3 seconds to hammer');
  });

  it('completes after a full pointer hold and announces it', () => {
    const onConfirm = vi.fn();
    const btn = renderHammer(onConfirm);
    fireEvent.pointerDown(btn);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText(t('ui.hold.statusHoldingMany', { left: 2 }))).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(HAMMER_HOLD_MS);
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('cancels on early release and says so', () => {
    const onConfirm = vi.fn();
    const btn = renderHammer(onConfirm);
    fireEvent.pointerDown(btn);
    act(() => {
      vi.advanceTimersByTime(HAMMER_HOLD_MS - 200);
    });
    fireEvent.pointerUp(btn);
    act(() => {
      vi.advanceTimersByTime(HAMMER_HOLD_MS);
    });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText(t('ui.hold.statusCancelled'))).toBeTruthy();
  });

  it('holding Space for the full time confirms, a tapped Space does not', () => {
    const onConfirm = vi.fn();
    const btn = renderHammer(onConfirm);
    fireEvent.keyDown(btn, { key: ' ' });
    fireEvent.keyUp(btn, { key: ' ' });
    act(() => {
      vi.advanceTimersByTime(HAMMER_HOLD_MS);
    });
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.keyDown(btn, { key: ' ' });
    fireEvent.keyDown(btn, { key: ' ', repeat: true });
    act(() => {
      vi.advanceTimersByTime(HAMMER_HOLD_MS);
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('reduced motion moves progress in whole seconds', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const btn = renderHammer(vi.fn());
    fireEvent.pointerDown(btn);
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(Number(btn.style.getPropertyValue('--ui-hold-p'))).toBeCloseTo(1 / 3, 5);
  });

  it('the stop dialog hold needs STOP, then 3 seconds', () => {
    const onKill = vi.fn();
    render(<KillSwitch stopped={false} onKill={onKill} />);
    fireEvent.click(screen.getByRole('button', { name: t('kill.button') }));
    const hold = screen.getByRole('button', { name: t('kill.hold') });
    fireEvent.pointerDown(hold);
    act(() => {
      vi.advanceTimersByTime(KILL_HOLD_MS);
    });
    expect(onKill).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(t('kill.type')), { target: { value: 'STOP' } });
    fireEvent.pointerDown(hold);
    act(() => {
      vi.advanceTimersByTime(KILL_HOLD_MS - 1);
    });
    expect(onKill).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onKill).toHaveBeenCalledTimes(1);
  });
});
