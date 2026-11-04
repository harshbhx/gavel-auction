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
