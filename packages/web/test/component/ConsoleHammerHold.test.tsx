import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../src/copy/t';
import type { ControlPort } from '../../src/net/transport';
import { Controls } from '../../src/screens/console/Controls';
import { HammerDialog } from '../../src/screens/console/HammerDialog';
import { HAMMER_HOLD_MS, HAMMER_HOLD_SECONDS } from '../../src/screens/console/hammerHold';

function fakePort(): ControlPort {
  return {
    open: vi.fn(() => Promise.resolve()),
    pause: vi.fn(() => Promise.resolve()),
    resume: vi.fn(() => Promise.resolve()),
    extend: vi.fn(() => Promise.resolve()),
    hammer: vi.fn(() => Promise.resolve()),
    kill: vi.fn(() => Promise.resolve()),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('hammer hold time (WEB-96)', () => {
  it('names whole seconds that match the delay', () => {
    expect(HAMMER_HOLD_SECONDS * 1000).toBe(HAMMER_HOLD_MS);
    expect(HAMMER_HOLD_SECONDS).toBeGreaterThanOrEqual(3);
  });

  it('the dialog says the hold time and confirms only after it', () => {
    const onConfirm = vi.fn();
    render(
      <HammerDialog
        open
        leader={{ paddle: 12, name: 'Priya' }}
        priceCents={40_000}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    const hint = t('console.hammerHint', { s: HAMMER_HOLD_SECONDS });
    expect(hint).toContain(`${HAMMER_HOLD_SECONDS} seconds`);
    expect(screen.getByText(hint)).toBeTruthy();
    const hold = screen.getByRole('button', { name: t('console.hammerHold') });
    fireEvent.pointerDown(hold);
    // The old delay: a hold this short must not close the lot any more.
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(onConfirm).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(HAMMER_HOLD_MS - 1201);
    });
    expect(onConfirm).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('the desk hold on the page promises the same time as the dialog', () => {
    render(
      <Controls
        port={fakePort()}
        lotId="lot1"
        status="OPEN"
        online
        stopped={false}
        leader={null}
        priceCents={0}
      />,
    );
    const desk = t('console.hammerDesk', { s: HAMMER_HOLD_SECONDS });
    expect(desk).toContain(`${HAMMER_HOLD_SECONDS} seconds`);
    expect(screen.getByText(desk)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t('console.hammer') }));
    expect(screen.getByText(t('console.hammerHint', { s: HAMMER_HOLD_SECONDS }))).toBeTruthy();
  });
});
