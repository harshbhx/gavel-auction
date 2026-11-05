import {
  mkdtempSync,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
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
    writeFileSync(join(dir, LOCK_FILE), JSON.stringify({ pid: 1, host: 'old', start: 1 }));
    const lock = acquireDataDirLock(dir, { pid: 1, host: 'new', isAlive: () => true });
    expect(JSON.parse(readFileSync(join(dir, LOCK_FILE), 'utf8')).host).toBe('new');
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
