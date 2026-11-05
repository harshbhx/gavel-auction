import {
  closeSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  utimesSync,
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
  /** How often the holder refreshes the lock file's mtime; default 10 s, 0 turns it off. */
  heartbeatMs?: number;
  /** Blocks for the given ms; used once to wait out a foreign lock's stale window. */
  sleep?: (ms: number) => void;
}

/** A lock owned by another host is stale once its mtime is this many heartbeats old. */
const HEARTBEAT_MISSES = 3;
const DEFAULT_HEARTBEAT_MS = 10_000;

interface Owner {
  pid: number;
  host: string;
  start: number;
}

/** Lock files held by this process, so a second acquire in the same process still refuses. */
const heldHere = new Set<string>();

function blockingSleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

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
  const sleep = opts.sleep ?? blockingSleep;
  let waited = false;

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
      const beatMs = opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
      const beat =
        beatMs > 0
          ? setInterval(() => {
              try {
                const t = new Date();
                utimesSync(file, t, t);
              } catch {
                // the lock is gone; release() copes with that
              }
            }, beatMs)
          : undefined;
      beat?.unref();
      return {
        release: () => {
          if (released) return;
          released = true;
          if (beat !== undefined) clearInterval(beat);
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
      const sameHost = owner.host === '' || owner.host === me.host;
      let live: boolean;
      if (sameHost) {
        // Same pid on the same host: an earlier life of this container (pid 1 on every start)
        // unless the record says it started after us. A pid in another namespace is not probed.
        live = owner.pid === me.pid ? owner.start > me.start : isAlive(owner.pid);
      } else {
        // Another host: a pid probe says nothing there. The lock is live while its owner
        // keeps refreshing the file.
        let age = 0;
        try {
          age = now() - statSync(file).mtimeMs;
        } catch {
          continue;
        }
        const beatMs = opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
        const windowMs = beatMs * HEARTBEAT_MISSES;
        live = beatMs <= 0 || age < windowMs;
        if (live && beatMs > 0 && !waited) {
          // A restarted container has a new hostname, so a differing host is no proof of a
          // live owner. Wait out the stale window once, then judge by the heartbeat again;
          // a live owner keeps refreshing the file and still wins.
          waited = true;
          sleep(Math.max(0, windowMs - age) + 1);
          attempt -= 1;
          continue;
        }
      }
      if (live) {
        throw new Error(
          `data directory ${dir} is in use by process ${String(owner.pid)} on ${owner.host}; refusing to start`,
        );
      }
    }
    removeStale(dir, file, text, now);
  }
  throw new Error(`could not lock data directory ${dir}`);
}

/**
 * Remove the stale lock `text` under a short-lived exclusive takeover file, so the compare and
 * the unlink cannot interleave with another starter's (R12-S13): whoever holds the takeover
 * file re-reads the lock, and a starter that already replaced it leaves it alone.
 */
function removeStale(dir: string, file: string, text: string, now: () => number): void {
  const guard = join(dir, `${LOCK_FILE}.takeover`);
  let fd: number;
  try {
    fd = openSync(guard, 'wx');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    try {
      // A starter that died inside the takeover leaves its guard behind; clear it once old.
      if (now() - statSync(guard).mtimeMs >= LOCK_UNPARSABLE_GRACE_MS) unlinkSync(guard);
    } catch {
      // gone already
    }
    return; // another starter is taking over; the next attempt sees its result
  }
  try {
    if (readFileSync(file, 'utf8') === text) unlinkSync(file);
  } catch {
    // already gone
  } finally {
    closeSync(fd);
    try {
      unlinkSync(guard);
    } catch {
      // already gone
    }
  }
}
