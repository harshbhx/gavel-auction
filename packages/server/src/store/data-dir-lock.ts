import {
  closeSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';

export const LOCK_FILE = 'gavel.lock';

/** A lock file with no readable owner is treated as held until it is this old (ms). */
export const LOCK_UNPARSABLE_GRACE_MS = 5_000;

export interface DataDirLock {
  /** Removes the lock file if this process still owns it. */
  release(): void;
}

export interface LockOptions {
  pid?: number;
  host?: string;
  /** Process start time, epoch ms; recorded in the lock for diagnostics. */
  startMs?: number;
  now?: () => number;
  isAlive?: (pid: number) => boolean;
}

interface Owner {
  pid: number;
  host: string;
  start: number;
}

/** Lock files held by this process, so a second acquire in the same process still refuses. */
const heldHere = new Set<string>();

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function parseOwner(text: string): Owner | undefined {
  try {
    const o = JSON.parse(text) as Partial<Owner>;
    if (
      Number.isInteger(o.pid) &&
      (o.pid as number) > 0 &&
      typeof o.host === 'string' &&
      typeof o.start === 'number'
    ) {
      return o as Owner;
    }
  } catch {
    // legacy "pid\n" format handled below
  }
  const pid = Number.parseInt(text.trim(), 10);
  if (/^\d+\s*$/.test(text) && Number.isInteger(pid) && pid > 0) return { pid, host: '', start: 0 };
  return undefined;
}

/**
 * Takes an exclusive lock on a data directory. The owner record is written to a temporary file
 * and hard-linked to `gavel.lock`, which is atomic and fails with EEXIST, so a second starter
 * never sees a half-written lock. A second process refuses to boot while the first is alive; a
 * lock left by a dead process or by this very pid (container restarts reuse pid 1) is replaced;
 * an unreadable lock younger than a few seconds counts as held. Two hosts on one directory would each trust
 * a private cache and diverge the chains (R-RT-061).
 */
export function acquireDataDirLock(dir: string, opts: LockOptions = {}): DataDirLock {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, LOCK_FILE);
  const me: Owner = {
    pid: opts.pid ?? process.pid,
    host: opts.host ?? hostname(),
    start: opts.startMs ?? Math.round(Date.now() - process.uptime() * 1000),
  };
  const now = opts.now ?? Date.now;
  const isAlive = opts.isAlive ?? alive;
  const mine = JSON.stringify(me);

  const tryCreate = (): boolean => {
    const tmp = join(dir, `${LOCK_FILE}.${String(me.pid)}.${String(now())}.tmp`);
    const fd = openSync(tmp, 'wx');
    try {
      writeSync(fd, mine);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    try {
      linkSync(tmp, file);
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw e;
    } finally {
      try {
        unlinkSync(tmp);
      } catch {
        // already gone
      }
    }
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    if (!heldHere.has(file) && tryCreate()) {
      heldHere.add(file);
      let released = false;
      return {
        release: () => {
          if (released) return;
          released = true;
          heldHere.delete(file);
          try {
            if (readFileSync(file, 'utf8') !== mine) return; // someone else's lock now
            unlinkSync(file);
          } catch {
            // already gone
          }
        },
      };
    }
    if (heldHere.has(file)) {
      throw new Error(
        `data directory ${dir} is in use by process ${String(me.pid)}; refusing to start`,
      );
    }
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const owner = parseOwner(text);
    if (owner === undefined) {
      let age = 0;
      try {
        age = now() - statSync(file).mtimeMs;
      } catch {
        continue;
      }
      if (age < LOCK_UNPARSABLE_GRACE_MS) {
        throw new Error(`data directory ${dir} has a lock being written; refusing to start`);
      }
    } else {
      // The recorded pid is this process's own pid: the lock is from an earlier life of the
      // container (pid 1 on every start) and cannot be held by anyone else.
      if (owner.pid !== me.pid && isAlive(owner.pid)) {
        throw new Error(
          `data directory ${dir} is in use by process ${String(owner.pid)}; refusing to start`,
        );
      }
    }
    try {
      if (readFileSync(file, 'utf8') === text) unlinkSync(file);
    } catch {
      // lost the race to another starter; the next attempt will see its lock
    }
  }
  throw new Error(`could not lock data directory ${dir}`);
}
