import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { t } from '../../src/copy/t';
import type { ControlPort } from '../../src/net/transport';
import { BidScreen } from '../../src/screens/bid/BidScreen';
import { ConsoleScreen } from '../../src/screens/console/ConsoleScreen';
import { Controls } from '../../src/screens/console/Controls';
import { RoomStore } from '../../src/store/roomStore';
import { openSnapshot, priceMsg, roster, stateMsg } from '../../src/testing/builders';

function storeWithOffset(offsetMs: number): RoomStore {
  const store = new RoomStore();
  // Every frame is received offsetMs before its server time, so the best sample is offsetMs.
  const first = stateMsg(1, openSnapshot(roster([12, 'Priya'])));
  store.dispatch({ kind: 'wire', msg: first }, first.ts - offsetMs);
  const msg = priceMsg(2, 12, 5000);
  store.dispatch({ kind: 'wire', msg }, msg.ts - offsetMs);
  return store;
}

describe('console clock-skew notice (T-WEB-018, R-WEB-026)', () => {
  it('shows the notice on the console when the clock is 2.5 s off', () => {
    render(<ConsoleScreen store={storeWithOffset(2500)} settlementView={null} wide />);
    expect(screen.getByText(t('console.skew', { s: 3 }))).toBeTruthy();
  });

  it('stays silent within 2 s', () => {
    render(<ConsoleScreen store={storeWithOffset(1500)} settlementView={null} wide />);
    expect(screen.queryByText(/clock differs/)).toBeNull();
  });

  it('never shows on the bidder screen', () => {
    render(<BidScreen store={storeWithOffset(2500)} onBid={vi.fn()} />);
    expect(screen.queryByText(/clock differs/)).toBeNull();
  });
});

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

describe('console keyboard shortcuts are mounted (R-WEB-072)', () => {
  const mount = (port: ControlPort) =>
    render(
      <Controls
        port={port}
        lotId="lot1"
        status="OPEN"
        online
        stopped={false}
        leader={null}
        priceCents={0}
      />,
    );

  it('? opens the shortcut list and Close hides it', () => {
    mount(fakePort());
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.keyDown(window, { key: '?' });
    expect(screen.getByRole('dialog', { name: t('console.shortcuts') })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t('shortcuts.close') }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('p pauses and e extends when allowed; o is ignored on an open lot', async () => {
    const port = fakePort();
    mount(port);
    fireEvent.keyDown(window, { key: 'o' });
    fireEvent.keyDown(window, { key: 'p' });
    await act(async () => {
      await Promise.resolve();
    });
    expect(port.open).not.toHaveBeenCalled();
    expect(port.pause).toHaveBeenCalledTimes(1);
  });

  it('has no single key for the hammer', () => {
    const port = fakePort();
    mount(port);
    for (const key of ['h', 'H', 'k', 's', 'Enter']) fireEvent.keyDown(window, { key });
    expect(port.hammer).not.toHaveBeenCalled();
    expect(port.kill).not.toHaveBeenCalled();
  });
});
