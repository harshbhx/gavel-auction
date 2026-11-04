import { describe, expect, it } from 'vitest';
import { SKEW_NOTICE_MS, skewFromOffset } from '../../src/net/clock';

describe('skew', () => {
  it('reports nothing within the limit', () => {
    expect(skewFromOffset(0)).toBe(0);
    expect(skewFromOffset(SKEW_NOTICE_MS)).toBe(0);
    expect(skewFromOffset(-SKEW_NOTICE_MS)).toBe(0);
  });

  it('reports the absolute skew over the limit in either direction', () => {
    expect(skewFromOffset(2500)).toBe(2500);
    expect(skewFromOffset(-2500)).toBe(2500);
  });
});
