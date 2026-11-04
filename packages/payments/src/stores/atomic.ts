import { randomBytes } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname } from 'node:path';

/**
 * Durable atomic file replace (R-PAY-042, R-PAY-060): the bytes go to a temp file
 * with a name unique to this write, are fsynced, renamed over the target, and the
 * directory is fsynced so the rename itself survives a power loss. A reader sees
 * either the old file or the new one, never a truncated mix, and two writers never
 * share a temp file.
 */
export function writeFileAtomicSync(path: string, text: string): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } catch (e) {
    closeSync(fd);
    try {
      unlinkSync(tmp);
    } catch {
      // the temp file is already gone
    }
    throw e;
  }
  closeSync(fd);
  try {
    renameSync(tmp, path);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      // the temp file is already gone
    }
    throw e;
  }
  syncDirectory(dir);
}

function syncDirectory(dir: string): void {
  let fd: number;
  try {
    fd = openSync(dir, 'r');
  } catch {
    return; // platforms that cannot open a directory
  }
  try {
    fsyncSync(fd);
  } catch {
    // directory fsync is not supported everywhere
  } finally {
    closeSync(fd);
  }
}
