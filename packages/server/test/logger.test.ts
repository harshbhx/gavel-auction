import { ManualClock } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { MemorySink, REDACTED, createLogger } from '../src/log/logger';

const FAKE_TOKEN = 'AAAAAAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBB';

function setup(level?: 'debug' | 'info' | 'warn' | 'error') {
  const sink = new MemorySink();
  const clock = new ManualClock();
  const log = createLogger({ clock, sink: sink.write, ...(level ? { level } : {}) });
  return { sink, clock, log };
}

describe('logger (R-RT-132)', () => {
  it('writes JSON lines with ts, level, msg and context', () => {
    const { sink, log } = setup();
    log.info('hello', { room: 'r1' });
    const [rec] = sink.records();
    expect(rec).toEqual({
      ts: expect.any(Number),
      level: 'info',
      msg: 'hello',
      context: { room: 'r1' },
    });
    expect(sink.lines[0]).not.toContain('\n');
  });

  it('filters below the minimum level', () => {
    const { sink, log } = setup('warn');
    log.debug('a');
    log.info('b');
    log.warn('c');
    log.error('d');
    expect(sink.records().map((r) => r.level)).toEqual(['warn', 'error']);
  });

  it('redacts token, secret and Authorization keys in nested objects (T-RT-091)', () => {
    const { sink, log } = setup();
    log.info('req', {
      Authorization: 'Bearer abcdefgh12345678',
      nested: { sessionToken: 'x', deep: [{ clientSecret: 'y', ok: 1 }] },
      headers: { authorization: 'z' },
    });
    const ctx = sink.records()[0]?.context as Record<string, unknown>;
    expect(ctx.Authorization).toBe(REDACTED);
    expect(ctx.nested).toEqual({
      sessionToken: REDACTED,
      deep: [{ clientSecret: REDACTED, ok: 1 }],
    });
    expect(ctx.headers).toEqual({ authorization: REDACTED });
  });

  it('redacts token-shaped strings and bearer values by pattern', () => {
    const { sink, log } = setup();
    log.warn(`bad ${FAKE_TOKEN} here`, { note: `got Bearer abcdefgh12345678`, list: [FAKE_TOKEN] });
    const line = sink.lines[0] ?? '';
    expect(line).not.toContain(FAKE_TOKEN);
    expect(line).not.toContain('abcdefgh12345678');
    expect(line).toContain(REDACTED);
  });

  it('child loggers merge and redact bound context', () => {
    const { sink, log } = setup();
    log.child({ room: 'r1', apiKey: 'k' }).child({ bidder: 'b1' }).info('x', { n: 1 });
    expect(sink.records()[0]?.context).toEqual({
      room: 'r1',
      apiKey: REDACTED,
      bidder: 'b1',
      n: 1,
    });
  });

  it('survives circular context and errors', () => {
    const { sink, log } = setup();
    const a: Record<string, unknown> = { name: 'a' };
    a.self = a;
    log.error('boom', { a, err: new Error(`failed ${FAKE_TOKEN}`) });
    const line = sink.lines[0] ?? '';
    expect(line).toContain('[circular]');
    expect(line).not.toContain(FAKE_TOKEN);
  });

  it('redacts the admin key, database url and similar names (R4-W06)', () => {
    const { sink, log } = setup();
    log.info('boot', {
      headers: { 'x-admin-key': 'k1', 'X-Admin-Key': 'k2' },
      env: { ADMIN_KEY: 'k3', DATABASE_URL: 'postgres://u:p@h/db', dsn: 'k4', adminKey: 'k5' },
      credential: 'k6',
      room: 'r1',
    });
    const line = sink.lines[0] ?? '';
    for (const v of ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'postgres://u:p@h']) {
      expect(line).not.toContain(v);
    }
    expect(line).toContain('r1');
  });

  it('redacts a password inside a connection URL in a message', () => {
    const { sink, log } = setup();
    log.error('connect failed postgres://svc:hunter2pass@db.internal:5432/gavel', {
      error: new Error('mysql://root:topsecretpw@10.0.0.1/app refused'),
    });
    const line = sink.lines[0] ?? '';
    expect(line).not.toContain('hunter2pass');
    expect(line).not.toContain('topsecretpw');
    expect(line).toContain('db.internal');
  });
});
