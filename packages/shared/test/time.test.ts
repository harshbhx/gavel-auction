import { describe, expect, it, vi } from 'vitest';
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

describe('ManualClock timers (T-RT-007)', () => {
  it('fires due timers in (time, registration) order, each seeing now() == due', () => {
    const c = new ManualClock(0);
    const seen: Array<[string, number]> = [];
    c.setTimer(10, () => seen.push(['a', c.now()]));
    c.setTimer(10, () => seen.push(['b', c.now()]));
    c.setTimer(5, () => seen.push(['c', c.now()]));
    c.advanceTo(20);
    expect(seen).toEqual([
      ['c', 5],
      ['a', 10],
      ['b', 10],
    ]);
    expect(c.now()).toBe(20);
  });

  it('does not fire timers that are not yet due', () => {
    const c = new ManualClock(0);
    let fired = 0;
    c.setTimer(10, () => fired++);
    c.advanceTo(9);
    expect(fired).toBe(0);
    c.advance(1);
    expect(fired).toBe(1);
  });

  it('cancel prevents firing and is idempotent', () => {
    const c = new ManualClock(0);
    let fired = 0;
    const cancel = c.setTimer(5, () => fired++);
    cancel();
    cancel();
    c.advanceTo(10);
    expect(fired).toBe(0);
  });

  it('fires each timer once', () => {
    const c = new ManualClock(0);
    let fired = 0;
    c.setTimer(5, () => fired++);
    c.advanceTo(10);
    c.advanceTo(20);
    expect(fired).toBe(1);
  });

  it('fires timers registered by a callback when they fall inside the window', () => {
    const c = new ManualClock(0);
    const seen: number[] = [];
    c.setTimer(5, () => {
      seen.push(c.now());
      c.setTimer(8, () => seen.push(c.now()));
      c.setTimer(50, () => seen.push(c.now()));
    });
    c.advanceTo(10);
    expect(seen).toEqual([5, 8]);
  });

  it('a timer already due fires at the current time on the next advance', () => {
    const c = new ManualClock(100);
    let at = -1;
    c.setTimer(50, () => {
      at = c.now();
    });
    c.advanceTo(100);
    expect(at).toBe(100);
  });

  it('cannot move backwards', () => {
    const c = new ManualClock(10);
    expect(() => c.advanceTo(5)).toThrow(RangeError);
  });
});

describe('SystemClock timers', () => {
  it('fires and can be cancelled', async () => {
    const c = new SystemClock();
    let fired = 0;
    c.setTimer(c.now() + 5, () => fired++);
    const cancel = c.setTimer(c.now() + 5, () => fired++);
    cancel();
    await new Promise((r) => setTimeout(r, 40));
    expect(fired).toBe(1);
  });
});

describe('SystemClock timers with fake time (R-RT-043)', () => {
  it('re-arms a delay beyond 2^31-1 ms instead of firing early', () => {
    vi.useFakeTimers();
    try {
      const c = new SystemClock();
      let fired = 0;
      c.setTimer(Date.now() + 3_000_000_000, () => fired++);
      vi.advanceTimersByTime(2_999_999_999);
      expect(fired).toBe(0);
      vi.advanceTimersByTime(1);
      expect(fired).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not fire until Date.now has reached the target', () => {
    vi.useFakeTimers();
    try {
      const c = new SystemClock();
      const target = Date.now() + 1000;
      let fired = 0;
      c.setTimer(target, () => fired++);
      const real = Date.now;
      // Simulate a timer that fires a millisecond early.
      vi.spyOn(Date, 'now').mockImplementation(() => real() - 1);
      vi.advanceTimersByTime(1000);
      expect(fired).toBe(0);
      vi.mocked(Date.now).mockRestore();
      vi.advanceTimersByTime(1);
      expect(fired).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancel stops a re-armed timer', () => {
    vi.useFakeTimers();
    try {
      const c = new SystemClock();
      let fired = 0;
      const cancel = c.setTimer(Date.now() + 3_000_000_000, () => fired++);
      vi.advanceTimersByTime(2_500_000_000);
      cancel();
      vi.advanceTimersByTime(1_000_000_000);
      expect(fired).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ManualClock.set fires due timers', () => {
  it('fires a timer when set moves past it', () => {
    const c = new ManualClock(0);
    let fired = 0;
    c.setTimer(10, () => fired++);
    c.set(11);
    expect(fired).toBe(1);
    expect(c.now()).toBe(11);
  });

  it('rewinding does not fire anything', () => {
    const c = new ManualClock(50);
    let fired = 0;
    c.setTimer(60, () => fired++);
    c.set(10);
    expect(fired).toBe(0);
    expect(c.now()).toBe(10);
  });
});
