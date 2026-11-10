import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../src/copy/t';
import type { ControlPort } from '../../src/net/transport';
import { Controls } from '../../src/screens/console/Controls';
import { ManualEntry } from '../../src/screens/console/ManualEntry';
import { PriceHeader } from '../../src/screens/console/PriceHeader';

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

afterEach(() => {
  vi.useRealTimers();
});

describe('console shortcuts', () => {
  function bar(port: ControlPort) {
    return (
      <Controls
        port={port}
        lotId="lot1"
        status="OPEN"
        online
        stopped={false}
        leader={null}
        priceCents={0}
      />
    );
  }

  it('shows a visible Shortcuts hint that opens the list', () => {
    render(bar(fakePort()));
    fireEvent.click(screen.getByRole('button', { name: t('console.shortcutsHint') }));
    expect(screen.getByText(t('shortcuts.confirmTwice'))).toBeTruthy();
  });

  it('needs the key twice: one press only arms the control', async () => {
    const port = fakePort();
    render(bar(port));
    fireEvent.keyDown(document.body, { key: 'p' });
    expect(port.pause).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(
      t('console.shortcut.armed', { key: 'P', action: t('console.pause') }),
    );
    await act(async () => {
      fireEvent.keyDown(document.body, { key: 'p' });
      await Promise.resolve();
    });
    expect(port.pause).toHaveBeenCalledTimes(1);
  });

  it('forgets the first press after three seconds', () => {
    vi.useFakeTimers();
    const port = fakePort();
    render(bar(port));
    fireEvent.keyDown(document.body, { key: 'e' });
    act(() => {
      vi.advanceTimersByTime(3100);
    });
    fireEvent.keyDown(document.body, { key: 'e' });
    expect(port.extend).not.toHaveBeenCalled();
  });
});

describe('console labels and manual entry', () => {
  it('labels the price, the bid count and the next bid', () => {
    render(
      <PriceHeader
        priceCents={1000}
        reserveCents={1000}
        leaderPaddle={null}
        leaderName={null}
        bidCount={0}
        endTs={0}
        now={() => 0}
        nextMinCents={1100}
      />,
    );
    expect(screen.getByText(t('console.board.price'))).toBeTruthy();
    expect(screen.getByText(t('console.board.count'))).toBeTruthy();
    expect(screen.getByText(t('console.board.next'))).toBeTruthy();
  });

  it('disables manual entry and says why once the lot is closed', () => {
    render(<ManualEntry roster={[]} onSubmit={() => 'sent'} rejection={null} closed />);
    expect(
      screen
        .getByRole('button', { name: t('console.manual.submit') })
        .getAttribute('aria-disabled'),
    ).toBe('true');
    expect(screen.getByText(t('console.manual.closed'))).toBeTruthy();
  });
});
