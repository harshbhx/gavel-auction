import {
  mkdtempSync,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireDataDirLock, LOCK_FILE } from '../src/store/data-dir-lock';

const dirs: string[] = [];
const fresh = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'gavel-dirlock-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('data directory lock (R6-A04)', () => {
  it('refuses a second holder until the first releases', () => {
    const dir = fresh();
    const first = acquireDataDirLock(dir);
    expect(() => acquireDataDirLock(dir)).toThrow(/in use by process/);
    first.release();
    expect(existsSync(join(dir, LOCK_FILE))).toBe(false);
    acquireDataDirLock(dir).release();
  });

  it('replaces a lock left by a process that is gone', () => {
    const dir = fresh();
    writeFileSync(join(dir, LOCK_FILE), '2147483646\n');
    acquireDataDirLock(dir).release();
  });

  it('treats a fresh unreadable lock as held, and an old one as stale (R7S-01)', () => {
    const dir = fresh();
    const file = join(dir, LOCK_FILE);
    writeFileSync(file, '');
    const t = 1_789_000_000_000;
    utimesSync(file, new Date(t), new Date(t));
    expect(() => acquireDataDirLock(dir, { now: () => t + 1_000 })).toThrow(/refusing to start/);
    expect(existsSync(file)).toBe(true);
    acquireDataDirLock(dir, { now: () => t + 60_000 }).release();
    expect(existsSync(file)).toBe(false);
  });

  it('leaves no temp files and release keeps a lock that now belongs to someone else (R7S-01)', () => {
    const dir = fresh();
    const first = acquireDataDirLock(dir, { pid: 4001 });
    expect(readdirSync(dir)).toEqual([LOCK_FILE]);
    writeFileSync(join(dir, LOCK_FILE), JSON.stringify({ pid: 4002, host: 'h', start: 1 }));
    first.release();
    expect(JSON.parse(readFileSync(join(dir, LOCK_FILE), 'utf8')).pid).toBe(4002);
  });

  it('replaces a lock that names this very pid, as after a container restart (R7S-02)', () => {
    const dir = fresh();
    writeFileSync(join(dir, LOCK_FILE), JSON.stringify({ pid: 1, host: 'same', start: 1 }));
    const lock = acquireDataDirLock(dir, { pid: 1, host: 'same', isAlive: () => true });
    expect(JSON.parse(readFileSync(join(dir, LOCK_FILE), 'utf8')).start).not.toBe(1);
    lock.release();
  });

  it('still refuses when another live pid holds the lock (R7S-02)', () => {
    const dir = fresh();
    writeFileSync(join(dir, LOCK_FILE), JSON.stringify({ pid: 7, host: 'h', start: 1 }));
    expect(() => acquireDataDirLock(dir, { pid: 1, isAlive: () => true })).toThrow(
      /in use by process 7/,
    );
  });
});

describe('data directory lock across hosts (R8-S02)', () => {
  const owner = (host: string, start: number): string => JSON.stringify({ pid: 1, host, start });

  it('refuses a second container that is also pid 1 on another host', () => {
    const dir = fresh();
    writeFileSync(join(dir, LOCK_FILE), owner('a1b2', 1000));
    expect(() =>
      acquireDataDirLock(dir, { pid: 1, host: 'c3d4', startMs: 2000, heartbeatMs: 0 }),
    ).toThrow(/in use by process 1 on a1b2/);
    expect(readFileSync(join(dir, LOCK_FILE), 'utf8')).toBe(owner('a1b2', 1000));
  });

  it('does not probe a pid of another host', () => {
    const dir = fresh();
    writeFileSync(join(dir, LOCK_FILE), owner('a1b2', 1000));
    let probed = false;
    expect(() =>
      acquireDataDirLock(dir, {
        pid: 7,
        host: 'c3d4',
        sleep: () => undefined,
        isAlive: () => {
          probed = true;
          return false;
        },
      }),
    ).toThrow(/refusing to start/);
    expect(probed).toBe(false);
  });

  it('takes over a lock of another host whose heartbeat stopped', () => {
    const dir = fresh();
    const file = join(dir, LOCK_FILE);
    writeFileSync(file, owner('a1b2', 1000));
    const mtime = statSync(file).mtimeMs;
    const lock = acquireDataDirLock(dir, {
      pid: 1,
      host: 'c3d4',
      startMs: 2000,
      heartbeatMs: 1000,
      now: () => mtime + 3500,
    });
    expect(JSON.parse(readFileSync(file, 'utf8')).host).toBe('c3d4');
    lock.release();
  });

  it('replaces a same-host same-pid lock from an earlier life', () => {
    const dir = fresh();
    writeFileSync(join(dir, LOCK_FILE), owner('a1b2', 1000));
    acquireDataDirLock(dir, { pid: 1, host: 'a1b2', startMs: 2000, heartbeatMs: 0 }).release();
  });

  it('waits out the stale window when a restarted container finds a dead owner (HRD-14)', () => {
    const dir = fresh();
    const file = join(dir, LOCK_FILE);
    writeFileSync(file, owner('a1b2', 1000));
    const mtime = statSync(file).mtimeMs;
    let clock = mtime + 5000;
    const slept: number[] = [];
    const lock = acquireDataDirLock(dir, {
      pid: 1,
      host: 'c3d4',
      startMs: 2000,
      heartbeatMs: 10_000,
      now: () => clock,
      sleep: (ms) => {
        slept.push(ms);
        clock += ms;
      },
    });
    expect(slept).toEqual([25_001]);
    expect(JSON.parse(readFileSync(file, 'utf8')).host).toBe('c3d4');
    lock.release();
  });

  it('still refuses when the foreign owner keeps heartbeating during the wait', () => {
    const dir = fresh();
    const file = join(dir, LOCK_FILE);
    writeFileSync(file, owner('a1b2', 1000));
    const mtime = statSync(file).mtimeMs;
    let clock = mtime + 5000;
    expect(() =>
      acquireDataDirLock(dir, {
        pid: 1,
        host: 'c3d4',
        startMs: 2000,
        heartbeatMs: 10_000,
        now: () => clock,
        sleep: (ms) => {
          clock += ms;
          utimesSync(file, new Date(clock), new Date(clock));
        },
      }),
    ).toThrow(/in use by process 1 on a1b2/);
  });
});
