/** First-visit guided tour: the step list, a small state machine and the localStorage record. */

export const TOUR_STEPS = ['join', 'ceiling', 'hold', 'bid', 'hammer', 'receipt'] as const;
export type TourStepId = (typeof TOUR_STEPS)[number];

export const TOUR_STORAGE_KEY = 'gavel.tour.v1';

export type TourStatus = 'idle' | 'running' | 'done' | 'skipped';

export interface TourState {
  readonly status: TourStatus;
  /** Index into TOUR_STEPS. Only meaningful while running. */
  readonly step: number;
}

export type TourAction =
  | { readonly type: 'start' }
  | { readonly type: 'next' }
  | { readonly type: 'back' }
  | { readonly type: 'skip' };

export const TOUR_IDLE: TourState = { status: 'idle', step: 0 };

export function tourReducer(state: TourState, action: TourAction): TourState {
  switch (action.type) {
    case 'start':
      return { status: 'running', step: 0 };
    case 'next':
      if (state.status !== 'running') return state;
      if (state.step >= TOUR_STEPS.length - 1) return { status: 'done', step: 0 };
      return { status: 'running', step: state.step + 1 };
    case 'back':
      if (state.status !== 'running') return state;
      return { status: 'running', step: Math.max(0, state.step - 1) };
    case 'skip':
      if (state.status !== 'running') return state;
      return { status: 'skipped', step: 0 };
  }
}

/** Minimal storage surface so tests can pass a stand-in. */
export interface TourStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): TourStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** True once the visitor has finished or skipped the tour. A broken or blocked store reads as not seen. */
export function hasSeenTour(storage: TourStorage | null = defaultStorage()): boolean {
  if (storage === null) return false;
  try {
    const value = storage.getItem(TOUR_STORAGE_KEY);
    return value === 'done' || value === 'skipped';
  } catch {
    return false;
  }
}

export function markTourSeen(
  status: 'done' | 'skipped',
  storage: TourStorage | null = defaultStorage(),
): void {
  if (storage === null) return;
  try {
    storage.setItem(TOUR_STORAGE_KEY, status);
  } catch {
    // A full or blocked store only means the tour may show again.
  }
}

export interface AutoStartInput {
  readonly search: string;
  readonly seen: boolean;
  readonly automated: boolean;
}

/**
 * The tour opens by itself once per browser. Automated browsers (tests, screenshot jobs) skip it
 * unless the URL asks for it with ?tour=1; ?tour=0 always skips it.
 */
export function shouldAutoStart({ search, seen, automated }: AutoStartInput): boolean {
  const flag = new URLSearchParams(search).get('tour');
  if (flag === '0') return false;
  if (flag === '1') return true;
  return !seen && !automated;
}

export function isAutomatedBrowser(): boolean {
  try {
    return typeof navigator !== 'undefined' && navigator.webdriver === true;
  } catch {
    return false;
  }
}

/** Sheet state: closed, the help menu, or the hold explainer. */
export type HelpView = 'closed' | 'menu' | 'hold';
export type HelpAction =
  { readonly type: 'openMenu' } | { readonly type: 'openHold' } | { readonly type: 'close' };

export function helpReducer(_state: HelpView, action: HelpAction): HelpView {
  switch (action.type) {
    case 'openMenu':
      return 'menu';
    case 'openHold':
      return 'hold';
    case 'close':
      return 'closed';
  }
}
