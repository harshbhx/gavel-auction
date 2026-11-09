import { afterEach, describe, expect, it, vi } from 'vitest';
import { SPEEDS } from '../../src/screens/demo/scriptedBeats';
import { VirtualClock } from '../../src/screens/demo/virtualClock';

afterEach(() => {
  vi.useRealTimers();
});

describe('VirtualClock', () => {
  it.each(SPEEDS)('advances virtual time at %sx', (speed) => {
    vi.useFakeTimers();
    const clock = new VirtualClock();
    clock.setSpeed(speed);
    clock.start();
    vi.advanceTimersByTime(1000);
    expect(clock.elapsed).toBeCloseTo(1000 * speed, 5);
    expect(clock.realUntil(2400)).toBeCloseTo((2400 - 1000 * speed) / speed, 5);
  });

  it('does not restart or jump when the speed changes mid-beat', () => {
    vi.useFakeTimers();
    const clock = new VirtualClock();
    clock.start();
    vi.advanceTimersByTime(600);
    clock.setSpeed(2);
    expect(clock.elapsed).toBeCloseTo(600, 5);
    vi.advanceTimersByTime(300);
    expect(clock.elapsed).toBeCloseTo(1200, 5);
    clock.setSpeed(1);
    vi.advanceTimersByTime(100);
    expect(clock.elapsed).toBeCloseTo(1300, 5);
  });

  it('holds still while stopped and resets to zero', () => {
    vi.useFakeTimers();
    const clock = new VirtualClock();
    clock.start();
    vi.advanceTimersByTime(500);
    clock.stop();
    vi.advanceTimersByTime(5000);
    expect(clock.elapsed).toBe(500);
    clock.reset();
    expect(clock.elapsed).toBe(0);
    expect(clock.running).toBe(false);
  });

  it('never reports negative real time once the limit has passed', () => {
    vi.useFakeTimers();
    const clock = new VirtualClock();
    clock.start();
    vi.advanceTimersByTime(3000);
    expect(clock.realUntil(2400)).toBe(0);
  });
});
