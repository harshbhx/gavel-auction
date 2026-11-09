import { afterEach } from 'vitest';
import { HISTORY_KEY } from '../../src/home/history';

afterEach(() => {
  try {
    globalThis.localStorage?.removeItem(HISTORY_KEY);
  } catch {
    // Some tests replace or block storage on purpose.
  }
});
