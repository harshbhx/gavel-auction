import { fireEvent, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';
import { HelpLayer } from '../../src/help';
import {
  TOUR_IDLE,
  TOUR_STEPS,
  TOUR_STORAGE_KEY,
  hasSeenTour,
  helpReducer,
  markTourSeen,
  shouldAutoStart,
  tourReducer,
  type TourStorage,
} from '../../src/help/tourState';

function memoryStorage(initial: Record<string, string> = {}): TourStorage {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
}

const throwing: TourStorage = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

afterEach(() => {
  window.localStorage.clear();
});

describe('tour state machine', () => {
  it('has the six steps in order', () => {
    expect(TOUR_STEPS).toEqual(['join', 'ceiling', 'hold', 'bid', 'hammer', 'receipt']);
  });

  it('walks forward to done and back', () => {
    let s = tourReducer(TOUR_IDLE, { type: 'start' });
    expect(s).toEqual({ status: 'running', step: 0 });
    s = tourReducer(s, { type: 'back' });
    expect(s.step).toBe(0);
    for (let i = 1; i < TOUR_STEPS.length; i += 1) s = tourReducer(s, { type: 'next' });
    expect(s).toEqual({ status: 'running', step: 5 });
    s = tourReducer(s, { type: 'back' });
    expect(s.step).toBe(4);
    s = tourReducer(s, { type: 'next' });
    s = tourReducer(s, { type: 'next' });
    expect(s.status).toBe('done');
  });

  it('skips from any step and ignores actions when idle', () => {
    const running = tourReducer(TOUR_IDLE, { type: 'start' });
    expect(tourReducer(running, { type: 'skip' }).status).toBe('skipped');
    expect(tourReducer(TOUR_IDLE, { type: 'next' })).toBe(TOUR_IDLE);
    expect(tourReducer(TOUR_IDLE, { type: 'skip' })).toBe(TOUR_IDLE);
  });

  it('replays after done', () => {
    const done = tourReducer({ status: 'running', step: 5 }, { type: 'next' });
    expect(tourReducer(done, { type: 'start' })).toEqual({ status: 'running', step: 0 });
  });
});

describe('help sheet state', () => {
  it('opens the menu, the hold explainer and closes', () => {
    expect(helpReducer('closed', { type: 'openMenu' })).toBe('menu');
    expect(helpReducer('menu', { type: 'openHold' })).toBe('hold');
    expect(helpReducer('hold', { type: 'close' })).toBe('closed');
  });
});

describe('tour storage', () => {
  it('records done and skipped, and treats other values as unseen', () => {
    const store = memoryStorage();
    expect(hasSeenTour(store)).toBe(false);
    markTourSeen('skipped', store);
    expect(hasSeenTour(store)).toBe(true);
    expect(hasSeenTour(memoryStorage({ [TOUR_STORAGE_KEY]: 'junk' }))).toBe(false);
  });

  it('never throws when storage is blocked', () => {
    expect(hasSeenTour(throwing)).toBe(false);
    expect(() => markTourSeen('done', throwing)).not.toThrow();
    expect(hasSeenTour(null)).toBe(false);
  });

  it('decides on auto start', () => {
    expect(shouldAutoStart({ search: '', seen: false, automated: false })).toBe(true);
    expect(shouldAutoStart({ search: '', seen: true, automated: false })).toBe(false);
    expect(shouldAutoStart({ search: '', seen: false, automated: true })).toBe(false);
    expect(shouldAutoStart({ search: '?scripted=1', seen: false, automated: false })).toBe(true);
    expect(shouldAutoStart({ search: '?tour=1', seen: true, automated: true })).toBe(true);
    expect(shouldAutoStart({ search: '?tour=0', seen: false, automated: false })).toBe(false);
  });
});

describe('HelpLayer', () => {
  it('opens the hold explainer from the help button and closes with Escape', () => {
    render(<HelpLayer autoStart={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    fireEvent.click(screen.getByRole('button', { name: 'What is a hold?' }));
    expect(screen.getByText('Hatched: held')).toBeTruthy();
    expect(screen.getByText('Solid: charged only if you win')).toBeTruthy();
    expect(screen.getByText('Hollow: released')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('runs the tour, stores the result and replays it from the menu', () => {
    render(<HelpLayer autoStart />);
    const dialog = screen.getByRole('dialog', { name: 'Guided tour' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByText('Step 1 of 6')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Step 2 of 6')).toBeTruthy();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.localStorage.getItem(TOUR_STORAGE_KEY)).toBe('skipped');

    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    fireEvent.click(screen.getByRole('button', { name: 'Replay the tour' }));
    expect(screen.getByText('Step 1 of 6')).toBeTruthy();
    for (let i = 0; i < TOUR_STEPS.length - 1; i += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(window.localStorage.getItem(TOUR_STORAGE_KEY)).toBe('done');
  });

  it('has no axe violations with the explainer open', async () => {
    const { container } = render(<HelpLayer autoStart={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    fireEvent.click(screen.getByRole('button', { name: 'What is a hold?' }));
    const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(result.violations).toEqual([]);
  });
});
