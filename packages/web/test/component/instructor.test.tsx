import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../src/copy/t';
import { Instructor } from '../../src/help/Instructor';
import { INSTRUCTOR_STEPS, bidderStep, consoleStep, hubStep } from '../../src/help/instructorSteps';

const ON = '?instructor=1';

beforeEach(() => {
  try {
    sessionStorage.clear();
  } catch {
    // none
  }
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Instructor', () => {
  it('is a region with a heading, open the first time, listing the steps', () => {
    render(<Instructor screen="console" judge current={1} search={ON} />);
    const region = screen.getByRole('region', { name: t('instructor.title') });
    expect(region).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(INSTRUCTOR_STEPS.console.length);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      screen.getByRole('button', { name: t('instructor.hide') }).getAttribute('aria-expanded'),
    ).toBe('true');
  });

  it('marks the current step from the room state', () => {
    render(<Instructor screen="console" judge current={1} search={ON} />);
    const here = screen.getAllByRole('listitem').filter((li) => li.getAttribute('aria-current'));
    expect(here).toHaveLength(1);
    expect(here[0]?.textContent).toContain(t('instructor.console.2'));
    expect(here[0]?.textContent).toContain(t('instructor.now'));
  });

  it('remembers a collapsed screen for the session, per screen', () => {
    const first = render(<Instructor screen="bid" judge current={0} search={ON} />);
    fireEvent.click(screen.getByRole('button', { name: t('instructor.hide') }));
    expect(
      screen.getByRole('button', { name: t('instructor.show') }).getAttribute('aria-expanded'),
    ).toBe('false');
    first.unmount();
    render(<Instructor screen="bid" judge current={0} search={ON} />);
    expect(screen.getByRole('button', { name: t('instructor.show') })).toBeTruthy();
    cleanup();
    // Another screen is not affected.
    render(<Instructor screen="receipt" judge current={0} search={ON} />);
    expect(screen.getByRole('button', { name: t('instructor.hide') })).toBeTruthy();
  });

  it('still works when storage throws', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    render(<Instructor screen="hub" judge current={0} search={ON} />);
    fireEvent.click(screen.getByRole('button', { name: t('instructor.hide') }));
    expect(screen.getByRole('button', { name: t('instructor.show') })).toBeTruthy();
  });

  it('is hidden for a room that is not a judge room, and for automated browsers by default', () => {
    const none = render(<Instructor screen="bid" judge={false} current={0} search={ON} />);
    expect(none.container.textContent).toBe('');
    cleanup();
    const auto = render(<Instructor screen="bid" judge current={0} search="" />);
    expect(auto.container.textContent).toBe('');
    cleanup();
    const off = render(<Instructor screen="bid" judge current={0} search="?instructor=0" />);
    expect(off.container.textContent).toBe('');
  });

  it('asks the room once when the caller does not know', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ judgeRoom: true }) }),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.doMock('../../src/config', () => ({ config: { apiBase: 'http://api.test' } }));
    render(<Instructor screen="receipt" roomId="room-ask" current={0} search={ON} />);
    expect(await screen.findByRole('region', { name: t('instructor.title') })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.doUnmock('../../src/config');
  });

  it('has no axe violations', async () => {
    const { container } = render(<Instructor screen="hub" judge current={2} search={ON} />);
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
