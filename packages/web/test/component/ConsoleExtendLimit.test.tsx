import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { t } from '../../src/copy/t';
import type { ControlPort } from '../../src/net/transport';
import {
  Controls,
  DEFAULT_EXTEND_MS,
  HARD_CLOSE_MARGIN_MS,
  disabledReason,
  extendsLeft,
} from '../../src/screens/console/Controls';
import { baseConfig } from '../../src/testing/builders';

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

function bar(left: number | null, port: ControlPort = fakePort()) {
  return (
    <Controls
      port={port}
      lotId="lot1"
      status="OPEN"
      online
      stopped={false}
      extendsLeft={left}
      leader={null}
      priceCents={0}
    />
  );
}

function note(): string | null {
  return document.querySelector('[data-slot="extends-left"]')?.textContent ?? null;
}

const extendName = t('console.extend', { s: DEFAULT_EXTEND_MS / 1000 });

describe('extendsLeft (WEB-95)', () => {
  // Two soft-close extensions of 30 s: the lot may run 60 s past its configured end.
  const config = { endTs: 1_000_000, softCloseExtensionMs: 30_000, maxExtensions: 2 };

  it('counts whole extends up to the hard close', () => {
    expect(extendsLeft(config, config.endTs)).toBe(2);
    expect(extendsLeft(config, config.endTs + 30_000)).toBe(1);
    expect(extendsLeft(config, config.endTs + 60_000)).toBe(0);
  });

  it('counts time a bid already added and never goes below zero', () => {
    expect(extendsLeft(config, config.endTs + 45_000)).toBe(0);
    expect(extendsLeft(config, config.endTs + 90_000)).toBe(0);
    expect(extendsLeft({ ...config, maxExtensions: 0 }, config.endTs)).toBe(0);
  });

  it('caps the room at the hard-close margin', () => {
    const wide = { endTs: 0, softCloseExtensionMs: 600_000, maxExtensions: 50 };
    expect(extendsLeft(wide, 0)).toBe(HARD_CLOSE_MARGIN_MS / DEFAULT_EXTEND_MS);
  });

  it('reads the limit from the room config the tests share', () => {
    const room = baseConfig.maxExtensions * baseConfig.softCloseExtensionMs;
    expect(extendsLeft(baseConfig, baseConfig.endTs)).toBe(Math.floor(room / DEFAULT_EXTEND_MS));
  });
});

describe('Extend at the limit (WEB-95)', () => {
  it('gives the reason only to Extend, and only at zero', () => {
    const state = { status: 'OPEN', online: true, stopped: false, busy: false } as const;
    expect(disabledReason('extend', { ...state, extendsLeft: 0 })).toBe(
      'controls.reason.noExtends',
    );
    expect(disabledReason('extend', { ...state, extendsLeft: 1 })).toBeNull();
    expect(disabledReason('extend', { ...state, extendsLeft: null })).toBeNull();
    expect(disabledReason('extend', state)).toBeNull();
    expect(disabledReason('pause', { ...state, extendsLeft: 0 })).toBeNull();
    expect(disabledReason('hammer', { ...state, extendsLeft: 0 })).toBeNull();
  });

  it('shows how many extends are left while Extend can be used', () => {
    const { rerender } = render(bar(2));
    expect(note()).toBe(t('controls.extendsLeft', { n: 2 }));
    expect(screen.getByRole('button', { name: extendName }).getAttribute('aria-disabled')).toBe(
      null,
    );
    rerender(bar(1));
    expect(note()).toBe(t('controls.extendsLeftOne'));
  });

  it('disables Extend at the limit, says why, and ignores the key', async () => {
    const port = fakePort();
    render(bar(0, port));
    const extend = screen.getByRole('button', { name: extendName });
    expect(extend.getAttribute('aria-disabled')).toBe('true');
    expect(note()).toBe(t('controls.reason.noExtends'));
    fireEvent.focus(extend);
    expect(document.querySelector('[data-slot="control-reason"]')?.textContent).toBe(
      t('controls.reason.noExtends'),
    );
    fireEvent.click(extend);
    fireEvent.keyDown(window, { key: 'e' });
    fireEvent.keyDown(window, { key: 'e' });
    await act(async () => {
      await Promise.resolve();
    });
    expect(port.extend).not.toHaveBeenCalled();
    // The hammer is not held back by the extend limit.
    expect(
      screen.getByRole('button', { name: t('console.hammer') }).getAttribute('aria-disabled'),
    ).toBeNull();
  });

  it('shows no count when the limit is not known', () => {
    render(bar(null));
    expect(note()).toBeNull();
    expect(
      screen.getByRole('button', { name: extendName }).getAttribute('aria-disabled'),
    ).toBeNull();
  });
});
