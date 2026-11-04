import { describe, expect, it } from 'vitest';
import { EpochMs, ManualClock, SystemClock } from '../src/time';

describe('clocks', () => {
  it('ManualClock set and advance', () => {
    const c = new ManualClock(100);
    expect(c.now()).toBe(100);
    c.advance(50);
    expect(c.now()).toBe(150);
    c.set(10);
    expect(c.now()).toBe(10);
  });
  it('SystemClock returns an integer near Date.now', () => {
    const n = new SystemClock().now();
    expect(Number.isInteger(n)).toBe(true);
    expect(Math.abs(n - Date.now())).toBeLessThan(1000);
  });
  it('EpochMs rejects non-integers', () => {
    expect(() => EpochMs(1.5)).toThrow();
  });
});
