import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../src/copy/t';
import { Instructor } from '../../src/help/Instructor';
import {
  INSTRUCTOR_BUTTONS,
  bidderStep,
  consoleStep,
  hubStep,
} from '../../src/help/instructorSteps';

const ON = '?instructor=1';

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    // none
  }
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const KEY = 'gavel:guide:console';

describe('Instructor guide', () => {
  it('is a labelled dialog that lists the screen buttons and focuses its heading', () => {
    render(<Instructor screen="console" judge search={ON} />);
    const dialog = screen.getByRole('dialog', { name: t('instructor.title') });
    expect(dialog).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(INSTRUCTOR_BUTTONS.console.length);
    for (const b of INSTRUCTOR_BUTTONS.console) {
      expect(dialog.textContent).toContain(t(b.name));
      expect(dialog.textContent).toContain(t(b.text));
    }
    expect(document.activeElement?.textContent).toBe(t('instructor.title'));
  });

  it('shows the first time, writes the seen key on dismiss, then stays away', () => {
    vi.stubEnv('MODE', 'production');
    const first = render(<Instructor screen="console" judge search="" />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t('instructor.gotIt') }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(localStorage.getItem(KEY)).toBe('seen');
    first.unmount();
    const second = render(<Instructor screen="console" judge search="" />);
    expect(second.container.textContent).toBe('');
    cleanup();
    // Another screen is not affected.
    render(<Instructor screen="bid" judge search="" />);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('closes with Escape and with a click outside, and remembers both', () => {
    vi.stubEnv('MODE', 'production');
    const first = render(<Instructor screen="console" judge search="" />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(localStorage.getItem(KEY)).toBe('seen');
    first.unmount();
    localStorage.clear();
    render(<Instructor screen="console" judge search="" />);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(localStorage.getItem(KEY)).toBe('seen');
  });

  it('?instructor=1 shows it again even when seen; ?instructor=0 hides it', () => {
    localStorage.setItem(KEY, 'seen');
    const on = render(<Instructor screen="console" judge search={ON} />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    on.unmount();
    vi.stubEnv('MODE', 'production');
    const off = render(<Instructor screen="console" judge search="?instructor=0" />);
    expect(off.container.textContent).toBe('');
  });

  it('still works when storage throws', () => {
    vi.stubEnv('MODE', 'production');
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    render(<Instructor screen="hub" judge search="" />);
    fireEvent.click(screen.getByRole('button', { name: t('instructor.gotIt') }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('lists the register screen buttons', () => {
    render(<Instructor screen="register" judge search={ON} />);
    const dialog = screen.getByRole('dialog', { name: t('instructor.title') });
    expect(screen.getAllByRole('listitem')).toHaveLength(INSTRUCTOR_BUTTONS.register.length);
    expect(dialog.textContent).toContain(t('instructor.register.3.name'));
  });

  it('is hidden for a room that is not a judge room, and for automated browsers by default', () => {
    const none = render(<Instructor screen="bid" judge={false} search={ON} />);
    expect(none.container.textContent).toBe('');
    cleanup();
    const auto = render(<Instructor screen="bid" judge search="" />);
    expect(auto.container.textContent).toBe('');
  });

  it('asks the room once when the caller does not know', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ judgeRoom: true }) }),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.doMock('../../src/config', () => ({ config: { apiBase: 'http://api.test' } }));
    render(<Instructor screen="receipt" roomId="room-ask" search={ON} />);
    expect(await screen.findByRole('dialog', { name: t('instructor.title') })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.doUnmock('../../src/config');
  });

  it('has no axe violations', async () => {
    const { container } = render(<Instructor screen="hub" judge search={ON} />);
    const result = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false } },
      resultTypes: ['violations'],
    });
    expect(result.violations).toEqual([]);
  });
});

describe('instructor steps follow the room', () => {
  it('hub: before the lot, while it runs, after it ends', () => {
    expect(hubStep({ status: 'SCHEDULED', ended: false })).toBe(0);
    expect(hubStep({ status: 'OPEN', ended: false })).toBe(3);
    expect(hubStep({ status: 'OPEN', ended: true })).toBe(4);
  });

  it('console: open, watching, hammer, over', () => {
    expect(consoleStep({ status: 'SCHEDULED', ended: false })).toBe(0);
    expect(consoleStep({ status: 'OPEN', ended: false })).toBe(1);
    expect(consoleStep({ status: 'CLOSING', ended: false })).toBe(2);
    expect(consoleStep({ status: 'OPEN', ended: true })).toBe(3);
  });

  it('bidder: limit, hold, bid, receipt', () => {
    expect(bidderStep({ status: 'OPEN', ended: false, hasLimit: false })).toBe(0);
    expect(bidderStep({ status: 'SCHEDULED', ended: false, hasLimit: true })).toBe(1);
    expect(bidderStep({ status: 'OPEN', ended: false, hasLimit: true })).toBe(2);
    expect(bidderStep({ status: 'DONE', ended: true, hasLimit: true })).toBe(3);
  });
});
