import { describe, expect, it } from 'vitest';
import { ERROR_CODES, ERROR_TABLE } from '../src/errors';

describe('error table (T-RT-008)', () => {
  it('every code has status, closeCode and retryable', () => {
    for (const code of ERROR_CODES) {
      const e = ERROR_TABLE[code];
      expect(e.status).toBeGreaterThanOrEqual(400);
      expect(e.closeCode === null || Number.isInteger(e.closeCode)).toBe(true);
      expect(typeof e.retryable).toBe('boolean');
    }
  });
  it('has no duplicate codes and table matches the list', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
    expect(Object.keys(ERROR_TABLE).sort()).toEqual([...ERROR_CODES].sort());
  });
  it('matches the snapshot', () => {
    expect(ERROR_TABLE).toMatchSnapshot();
  });
});
