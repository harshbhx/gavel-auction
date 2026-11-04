import { ManualClock } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { startRecovery } from '../src/room/recover-resume';

const START = 1_789_000_000_000;

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('T-RT-051 recovery loop', () => {
  it('resumes at start and every 30 s, never overlapping', async () => {
    const clock = new ManualClock(START);
    let calls = 0;
    let running = 0;
    let maxRunning = 0;
    const loop = startRecovery({
      clock,
      service: {
        resume: async () => {
          calls += 1;
          running += 1;
          maxRunning = Math.max(maxRunning, running);
          await Promise.resolve();
          running -= 1;
        },
      },
    });
    await loop.started;
    expect(calls).toBe(1);
    clock.advanceTo(START + 29_999);
    await flush();
    expect(calls).toBe(1);
    clock.advanceTo(START + 30_000);
    await flush();
    expect(calls).toBe(2);
    clock.advanceTo(START + 60_000);
    await flush();
    expect(calls).toBe(3);
    expect(maxRunning).toBe(1);
    loop.stop();
    clock.advanceTo(START + 200_000);
    await flush();
    expect(calls).toBe(3);
  });

  it('reports a failed pass and keeps going', async () => {
    const clock = new ManualClock(START);
    const errors: unknown[] = [];
    let calls = 0;
    const loop = startRecovery({
      clock,
      onError: (e) => errors.push(e),
      service: {
        resume: () => {
          calls += 1;
          return calls === 1 ? Promise.reject(new Error('store down')) : Promise.resolve();
        },
      },
    });
    await loop.started;
    expect(errors).toHaveLength(1);
    clock.advanceTo(START + 30_000);
    await flush();
    expect(calls).toBe(2);
    loop.stop();
  });
});
