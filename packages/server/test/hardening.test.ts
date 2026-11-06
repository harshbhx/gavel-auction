import { describe, expect, it } from 'vitest';
import { installFatalHandlers } from '../src/ops/fatal';
import { jsonbText } from '../src/store/postgres';
import { MemoryStore } from '../src/store/memory-store';
import type { AuctionId } from '@gavel/shared';

describe('fatal process handlers (#1750)', () => {
  it('logs, runs the shutdown once and exits non-zero on an unhandled rejection', async () => {
    const handlers = new Map<string, (err: unknown) => void>();
    const logs: string[] = [];
    const exits: number[] = [];
    let shutdowns = 0;
    installFatalHandlers(
      { on: (event, fn) => void handlers.set(event, fn) },
      {
        onError: (m) => void logs.push(m),
        shutdown: () => {
          shutdowns += 1;
          return Promise.resolve(0);
        },
        exit: (code) => void exits.push(code),
      },
    );
    handlers.get('unhandledRejection')?.(new Error('boom'));
    handlers.get('uncaughtException')?.(new Error('second'));
    await Promise.resolve();
    await Promise.resolve();
    expect(logs[0]).toContain('unhandledRejection');
    expect(logs[0]).toContain('boom');
    expect(logs).toHaveLength(2);
    expect(shutdowns).toBe(1);
    expect(exits).toEqual([1]);
  });
});

describe('storage input (#1752)', () => {
  it('drops NUL from jsonb text and keeps a literal backslash sequence', () => {
    const text = jsonbText({ name: 'a\u0000b', note: '\\u0000' });
    expect(text).not.toContain('\\u0000b');
    expect(JSON.parse(text)).toEqual({ name: 'ab', note: '\\u0000' });
  });

  it('never replaces a newer snapshot with an older one', async () => {
    const s = new MemoryStore(() => 0);
    const a = 'A1' as AuctionId;
    await s.saveSnapshot(a, 5, { n: 5 });
    await s.saveSnapshot(a, 3, { n: 3 });
    expect(await s.loadSnapshot(a)).toEqual({ seq: 5, state: { n: 5 } });
  });
});

describe('manual bid rate limit (#1751)', () => {
  it('shares one bucket across sockets of the same auctioneer', async () => {
    const { setup } = await import('./room-harness');
    const t = await setup({ limiter: true });
    const first = await t.connect('auctioneer');
    const msg = { ...t.bid(10000), bidderId: t.b2 };
    for (let i = 0; i < 20; i++)
      await t.room.submitBid(first.conn, { ...msg, mid: t.ids.mint<'MsgId'>() });
    const second = await t.connect('auctioneer');
    await t.room.submitBid(second.conn, { ...msg, mid: t.ids.mint<'MsgId'>() });
    expect(second.transport.messages('error').map((m) => m.code)).toContain('rate_limited');
  });
});
