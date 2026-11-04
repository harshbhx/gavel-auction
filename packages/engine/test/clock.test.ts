import { describe, expect, it } from 'vitest';
import { ManualClock, monotonicAt } from '../src/clock.js';

describe('clock', () => {
  it('T-ENG-004 (R-ENG-004): monotonicAt clamps to the head', () => {
    expect(monotonicAt(1999, 2000)).toBe(2000);
    expect(monotonicAt(2001, 2000)).toBe(2001);
  });
  it('ManualClock advance and set', () => {
    const c = new ManualClock(10);
    expect(c.advance(5)).toBe(15);
    c.set(3);
    expect(c.nowMs()).toBe(3);
  });
});
