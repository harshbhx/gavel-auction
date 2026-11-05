#!/usr/bin/env node
// Fails when source or configuration names a live PayPal host (T-QA-040, R-QA-038).
// Usage: node scripts/check-no-live-host.mjs [--root <dir>]
// Scanned: every text file under the root except dependency, build and report folders, test
// folders and test files (they name live hosts on purpose, to prove those hosts are refused),
// docs, the lock file and this script. The sandbox hosts do not match: only the live API host
// and the live checkout host do.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(import.meta.url);
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'coverage',
  'report',
  'test',
  'tests',
  'docs',
  'reference',
]);
const SKIP_FILES = new Set(['package-lock.json']);
const MAX_BYTES = 2 * 1024 * 1024;

/** The live REST host, and the live checkout host in any position that is not a subdomain label. */
export const LIVE_HOST_PATTERNS = [/api-m\.paypal\.com/i, /(?<![\w.-])www\.paypal\.com/i];

export function findLiveHosts(text) {
  const hits = [];
  for (const re of LIVE_HOST_PATTERNS) {
    const m = re.exec(text);
    if (m) hits.push(m[0]);
  }
  return hits;
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name)) yield* walk(p);
    } else if (st.isFile() && st.size <= MAX_BYTES) {
      if (SKIP_FILES.has(name) || /\.test\.[cm]?[jt]sx?$/.test(name) || p === HERE) continue;
      yield p;
    }
  }
}

/** Returns "path: host" for every offending file under the root. */
export function scan(root) {
  const found = [];
  for (const file of walk(root)) {
    const buf = readFileSync(file);
    if (buf.includes(0)) continue;
    for (const host of findLiveHosts(buf.toString('utf8'))) {
      found.push(`${relative(root, file)}: ${host}`);
    }
  }
  return found;
}

function main(argv) {
  const i = argv.indexOf('--root');
  const root = i >= 0 ? argv[i + 1] : '.';
  const found = scan(root);
  for (const line of found) console.error(`live host: ${line}`);
  if (found.length === 0) console.log(`no live PayPal host under ${basename(root) || root}`);
  return found.length === 0 ? 0 : 1;
}

if (process.argv[1] === HERE) process.exit(main(process.argv.slice(2)));
