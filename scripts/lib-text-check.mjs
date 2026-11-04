// Shared helpers for the ASCII and banned-word checks: file selection and binary detection.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const BINARY_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.pdf',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.zip',
  '.gz',
  '.mp3',
  '.wav',
  '.ogg',
  '.opus',
  '.mp4',
  '.webm',
  '.wasm',
]);

export function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i += 1;
        if (glob[i + 1] === '/') {
          i += 1;
          out += '(?:.*/)?';
        } else {
          out += '.*';
        }
      } else {
        out += '[^/]*';
      }
    } else {
      out += c.replace(/[.+^${}()|[\]\\?]/g, '\\$&');
    }
  }
  return new RegExp(`^${out}$`);
}

export function loadIgnore(root, name) {
  const file = join(root, name);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'))
    .map(globToRegExp);
}

/** Tracked files when no paths are given (whole-tree mode), otherwise the given paths (staged mode). */
export function selectFiles(root, paths) {
  if (paths.length > 0) return paths;
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
  return out.split('\0').filter((f) => f !== '');
}

/** Returns the text of a file, or undefined for binary, missing or unreadable files. */
export function readText(root, file) {
  const dot = file.lastIndexOf('.');
  if (dot !== -1 && BINARY_EXT.has(file.slice(dot).toLowerCase())) return undefined;
  const full = join(root, file);
  if (!existsSync(full)) return undefined;
  let buf;
  try {
    buf = readFileSync(full);
  } catch {
    return undefined;
  }
  if (buf.includes(0)) return undefined;
  return buf.toString('utf8');
}
