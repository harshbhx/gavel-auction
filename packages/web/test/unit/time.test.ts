import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serverNow } from '../../src/net/clock';
import { formatCountdown } from '../../src/util/time';

describe('server clock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('adds the measured offset to the local clock', () => {
    expect(serverNow(5000)).toBe(1_700_000_005_000);
    expect(serverNow(-250)).toBe(1_699_999_999_750);
  });

  it('counts down against server time', () => {
    const closesAt = serverNow(5000) + 61_000;
    expect(formatCountdown(closesAt - serverNow(5000))).toBe('1:01');
  });
});

describe('formatCountdown', () => {
  it('formats minutes and seconds', () => {
    expect(formatCountdown(61_000)).toBe('1:01');
    expect(formatCountdown(9_000)).toBe('0:09');
    expect(formatCountdown(3_600_000)).toBe('1:00:00');
  });

  it('rounds partial seconds up so the display never reads 0:00 early', () => {
    expect(formatCountdown(1)).toBe('0:01');
  });

  it('shows 0:00 for zero or negative remaining time', () => {
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(-5000)).toBe('0:00');
  });
});
