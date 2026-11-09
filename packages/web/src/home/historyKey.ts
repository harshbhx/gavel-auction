/** The localStorage key of the browser history. Kept apart so the start page can look without loading the store. */
export const HISTORY_KEY = 'gavel.history.v1';

/** True when this browser has stored something under the history key. Never throws. */
export function storedHistoryExists(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(HISTORY_KEY) !== null;
  } catch {
    return false;
  }
}
