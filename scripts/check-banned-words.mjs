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

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const matcher = buildMatcher(loadWordList(root, process.env));
  if (!matcher) {
    console.log('check:banned-words skipped: no word list configured (BANNED_WORDS or local file)');
    process.exit(0);
  }
  const files = selectFiles(root, process.argv.slice(2));
  const failures = checkFiles(root, files, matcher);
  for (const f of failures) console.error(`${f.file}:${f.line}:${f.column} contains a banned word`);
  if (failures.length > 0) {
    console.error(`check:banned-words failed: ${failures.length} match(es)`);
    process.exit(1);
  }
  console.log(`check:banned-words ok (${files.length} files)`);
}
