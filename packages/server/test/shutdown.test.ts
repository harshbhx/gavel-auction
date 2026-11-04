import { ManualClock } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { CLOSE_GOING_AWAY, createShutdown } from '../src/ops/shutdown';

function setup(opts: { roomClose?: () => Promise<void> } = {}) {
  const clock = new ManualClock(1_789_000_000_000);
  const log: string[] = [];
  const exits: number[] = [];
  const closes: Array<{ code: number; reason: string }> = [];
  const sd = createShutdown({
    clock,
    stopAccepting: async () => {
      log.push('stop');
    },
    rooms: () => [
      {
        close:
          opts.roomClose ??
          (async () => {
            log.push('drain');
          }),
      },
    ],
    closeConnections: (code, reason) => {
      log.push('sockets');
      closes.push({ code, reason });
    },
    exit: (code) => {
      exits.push(code);
    },
  });
  return { clock, sd, log, exits, closes };
}

describe('graceful shutdown (T-RT-095)', () => {
  it('stops accepting, drains, closes sockets with 1001, then exits 0', async () => {
    const { sd, log, exits, closes } = setup();
    await expect(sd.run()).resolves.toBe(0);
    expect(log).toEqual(['stop', 'drain', 'sockets']);
    expect(closes[0]?.code).toBe(CLOSE_GOING_AWAY);
    expect(exits).toEqual([0]);
  });

  it('runs once for repeated signals', async () => {
    const { sd, exits } = setup();
    const handlers: Array<() => void> = [];
    sd.install({ once: (_s, fn) => handlers.push(fn) });
    handlers[0]?.();
    await sd.run();
    await sd.run();
    expect(exits).toEqual([0]);
  });

  it('forces exit 1 at the 10 s deadline when a room never drains', async () => {
    const { clock, sd, exits, closes } = setup({ roomClose: () => new Promise<void>(() => {}) });
    const done = sd.run();
    await Promise.resolve();
    clock.advance(9_999);
    expect(exits).toEqual([]);
    clock.advance(1);
    await expect(done).resolves.toBe(1);
    expect(exits).toEqual([1]);
    expect(closes[0]?.code).toBe(1001);
  });

  it('exits 1 when a room fails to close', async () => {
    const { sd, exits } = setup({ roomClose: () => Promise.reject(new Error('boom')) });
    await expect(sd.run()).resolves.toBe(1);
    expect(exits).toEqual([1]);
  });
});
