#!/usr/bin/env node
// Fails when a text file contains a word from the banned list (R-QA-017).
// The list is read from env BANNED_WORDS (comma or newline separated, a CI secret) or from the
// untracked file scripts/banned-words.txt. The list is never committed and never printed:
// failures report only file, line and column.
// Usage: node scripts/check-banned-words.mjs            whole tree (tracked files)
//        node scripts/check-banned-words.mjs a.md b.ts  only the given files (pre-commit)
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readText, selectFiles } from './lib-text-check.mjs';

const scriptRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

export function parseWordList(raw) {
  return raw
    .split(/[\n,]/)
    .map((w) => w.trim())
    .filter((w) => w !== '' && !w.startsWith('#'));
}

export function loadWordList(rootDir, env) {
  if (env.BANNED_WORDS && env.BANNED_WORDS.trim() !== '') return parseWordList(env.BANNED_WORDS);
  const local = join(rootDir, 'scripts', 'banned-words.txt');
  if (existsSync(local)) return parseWordList(readFileSync(local, 'utf8'));
  return [];
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildMatcher(words) {
  if (words.length === 0) return undefined;
  return new RegExp(`(?<![A-Za-z0-9])(?:${words.map(escapeRegExp).join('|')})(?![A-Za-z0-9])`, 'i');
}

/** Returns [{line, column}] for each line that contains a listed word. */
export function findBanned(text, matcher) {
  const found = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const m = matcher.exec(lines[i]);
    if (m) found.push({ line: i + 1, column: m.index + 1 });
  }
  return found;
}

export function checkFiles(rootDir, files, matcher) {
  const failures = [];
  for (const file of files) {
    const normal = file.replace(/\\/g, '/').replace(/^\.\//, '');
    const text = readText(rootDir, normal);
    if (text === undefined) continue;
    for (const hit of findBanned(text, matcher)) failures.push({ file: normal, ...hit });
  }
  return failures;
}

/**
 * Decides what to do when no word list is configured. Outside CI a missing list is skipped so
 * local runs work; in CI it is a failure, except where the run opts out (pull requests from
 * forks never receive the secret, and the same check runs again on the main branch).
 */
export function emptyListOutcome(env) {
  if (env.CI !== 'true' && env.CI !== '1') return 'skip';
  return env.BANNED_WORDS_ALLOW_EMPTY === 'true' ? 'skip' : 'fail';
}

/** Splits argv into the optional --root <dir> (the tree to scan) and the file arguments. */
export function parseArgs(argv) {
  const files = [];
  let target;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--root') target = argv[(i += 1)];
    else files.push(argv[i]);
  }
  return { target, files };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // The script may run from a trusted checkout (the base commit) while scanning another tree.
  const { target, files: given } = parseArgs(process.argv.slice(2));
  const root = target ? join(process.cwd(), target) : scriptRoot;
  const matcher = buildMatcher(loadWordList(root, process.env));
  if (!matcher) {
    if (emptyListOutcome(process.env) === 'fail') {
      console.error('check:banned-words failed: no word list configured in CI (BANNED_WORDS)');
      process.exit(1);
    }
    console.log('check:banned-words skipped: no word list configured (BANNED_WORDS or local file)');
    process.exit(0);
  }
  const files = selectFiles(root, given);
  const failures = checkFiles(root, files, matcher);
  for (const f of failures) console.error(`${f.file}:${f.line}:${f.column} contains a banned word`);
  if (failures.length > 0) {
    console.error(`check:banned-words failed: ${failures.length} match(es)`);
    process.exit(1);
  }
  console.log(`check:banned-words ok (${files.length} files)`);
}
