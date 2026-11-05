import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { join } from 'node:path';

export const LOCK_FILE = 'gavel.lock';

export interface DataDirLock {
  /** Removes the lock file if this process still owns it. */
  release(): void;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Takes an exclusive lock on a data directory with a pid file created with O_EXCL. A second
 * process refuses to boot while the first is alive; a lock left by a dead process is replaced.
 * Two hosts on one directory would each trust a private cache and diverge the chains (R-RT-061).
 */
export function acquireDataDirLock(dir: string): DataDirLock {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, LOCK_FILE);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fd = openSync(file, 'wx');
      try {
        writeSync(fd, `${process.pid}\n`);
      } finally {
        closeSync(fd);
      }
      let released = false;
      return {
        release: () => {
          if (released) return;
          released = true;
          try {
            unlinkSync(file);
          } catch {
            // already gone
          }
        },
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    let owner = NaN;
    try {
      owner = Number.parseInt(readFileSync(file, 'utf8').trim(), 10);
    } catch {
      continue;
    }
    if (Number.isInteger(owner) && owner > 0 && alive(owner)) {
      throw new Error(`data directory ${dir} is in use by process ${owner}; refusing to start`);
    }
    try {
      unlinkSync(file);
    } catch {
      // lost the race to another starter; the next attempt will see its lock
    }
  }
  throw new Error(`could not lock data directory ${dir}`);
}
