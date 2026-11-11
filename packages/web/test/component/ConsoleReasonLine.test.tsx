import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { t } from '../../src/copy/t';
import type { ControlPort } from '../../src/net/transport';
import {
  CONTROL_ORDER,
  Controls,
  disabledReason,
  lotReason,
  shownControls,
  type ControlState,
} from '../../src/screens/console/Controls';
import type { AuctionStatus } from '../../src/wire';

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

function bar(status: AuctionStatus, port: ControlPort = fakePort(), stopped = false) {
  return (
    <Controls
      port={port}
      lotId="lot1"
      status={status}
      online
      stopped={stopped}
      leader={null}
      priceCents={0}
    />
  );
}

function line(): string {
  return document.querySelector('[data-slot="control-reason"]')?.textContent ?? '';
}

const STATES: readonly AuctionStatus[] = ['SCHEDULED', 'OPEN', 'PAUSED', 'CLOSING', 'DONE'];

describe('console reason line (WEB-99)', () => {
  it('gives a lot-wide reason only when every shown button is off for it', () => {
    for (const status of STATES) {
      for (const stopped of [false, true]) {
        const state: ControlState = { status, online: true, stopped, busy: false };
        const reason = lotReason(state);
        const reasons = shownControls(status).map((n) => disabledReason(n, state));
        if (reasons.some((r) => r === null)) expect(reason).toBeNull();
        else expect(reasons.every((r) => r === reason)).toBe(true);
      }
    }
  });

  it('is empty on an open lot and never says the lot is already open', () => {
    render(bar('OPEN'));
    expect(line()).toBe('');
    for (const name of [t('console.pause'), t('console.extend', { s: 30 }), t('console.hammer')]) {
      const button = screen.getByRole('button', { name });
      expect(button.getAttribute('aria-disabled')).toBeNull();
      fireEvent.focus(button);
      expect(line()).not.toBe(t('controls.reason.alreadyOpen'));
      fireEvent.blur(button);
    }
  });

  it('says what an enabled control will do while it is aimed at', () => {
    render(bar('OPEN'));
    const extend = screen.getByRole('button', { name: t('console.extend', { s: 30 }) });
    fireEvent.focus(extend);
    expect(line()).toBe(t('controls.does.extend', { s: 30 }));
    fireEvent.blur(extend);
    expect(line()).toBe('');
    fireEvent.focus(screen.getByRole('button', { name: t('console.resume') }));
    expect(line()).toBe(t('controls.reason.notPaused'));
  });

  it('keeps one reason for a stopped or ended lot', () => {
    const { rerender } = render(bar('OPEN', fakePort(), true));
    expect(line()).toBe(t('controls.reason.stopped'));
    rerender(bar('DONE'));
    expect(line()).toBe(t('controls.reason.ended'));
  });
});

describe('Open lot slot (WEB-99)', () => {
  it('is a working button before the lot opens', () => {
    const port = fakePort();
    render(bar('SCHEDULED', port));
    const open = screen.getByRole('button', { name: t('console.open') });
    expect(open.getAttribute('aria-disabled')).toBeNull();
    fireEvent.focus(open);
    expect(line()).toBe(t('controls.does.open'));
    fireEvent.click(open);
    expect(port.open).toHaveBeenCalledWith('lot1');
  });

  it('turns into a note once the lot has opened, in the same slot', () => {
    const notes: ReadonlyArray<readonly [AuctionStatus, string]> = [
      ['OPEN', t('controls.lot.open')],
      ['PAUSED', t('controls.lot.paused')],
      ['DONE', t('controls.lot.closed')],
    ];
    for (const [status, text] of notes) {
      const { unmount } = render(bar(status));
      expect(screen.queryByRole('button', { name: t('console.open') })).toBeNull();
      const slot = document.querySelector('[data-testid="control-bar"] > [data-control="open"]');
      expect(slot?.textContent).toBe(text);
      expect(shownControls(status)).toEqual(CONTROL_ORDER.filter((n) => n !== 'open'));
      unmount();
    }
  });
});
