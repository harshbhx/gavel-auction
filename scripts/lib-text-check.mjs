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

const PRINTABLE_RATIO = 0.9;

function printableRatio(text) {
  if (text.length === 0) return 1;
  let ok = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c !== 127 && c !== 0xfffd)) ok += 1;
  }
  return ok / text.length;
}

function decodeUtf16(buf, bigEndian) {
  const body = Buffer.from(buf.subarray(2));
  if (bigEndian) body.swap16();
  return body.toString('utf16le');
}

/** UTF-16 without a byte order mark: NUL on every other byte for the first bytes. */
function bareUtf16Order(buf) {
  const n = Math.min(buf.length, 512) & ~1;
  if (n < 16) return undefined;
  let even = 0;
  let odd = 0;
  for (let i = 0; i < n; i += 2) {
    if (buf[i] === 0) even += 1;
    if (buf[i + 1] === 0) odd += 1;
  }
  const pairs = n / 2;
  if (odd / pairs > 0.4 && even === 0) return 'le';
  if (even / pairs > 0.4 && odd === 0) return 'be';
  return undefined;
}

/**
 * Returns the text of a file, or undefined for missing, unreadable or genuinely binary files.
 * Content decides, not the name: a file under a media extension is still scanned when its bytes
 * are mostly printable text, and a NUL byte (UTF-16 text, or one stray NUL) does not exempt a file.
 */
export function readText(root, file) {
  const dot = file.lastIndexOf('.');
  const mediaExt = dot !== -1 && BINARY_EXT.has(file.slice(dot).toLowerCase());
  const full = join(root, file);
  if (!existsSync(full)) return undefined;
  let buf;
  try {
    buf = readFileSync(full);
  } catch {
    return undefined;
  }
  let text;
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) text = decodeUtf16(buf, false);
  else if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) text = decodeUtf16(buf, true);
  else {
    const bare = bareUtf16Order(buf);
    if (bare === 'le') text = buf.toString('utf16le');
    else if (bare === 'be') text = decodeUtf16(Buffer.concat([Buffer.alloc(2), buf]), true);
  }
  if (text !== undefined) return printableRatio(text) >= PRINTABLE_RATIO ? text : undefined;
  if (!buf.includes(0)) {
    const utf8 = buf.toString('utf8');
    if (!mediaExt) return utf8;
    // A media extension on mostly printable text is disguised text, not media.
    return printableRatio(utf8) >= PRINTABLE_RATIO ? utf8 : undefined;
  }
  // Stray NUL bytes: real media stays exempt; anything else is scanned with the NULs removed
  // when the rest reads as text.
  if (mediaExt) return undefined;
  const stripped = buf.toString('utf8').replace(/\0/g, '');
  return printableRatio(stripped) >= PRINTABLE_RATIO ? stripped : undefined;
}
