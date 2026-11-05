import { mkdtempSync, existsSync, rmSync, writeFileSync } from 'node:fs';
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
});
