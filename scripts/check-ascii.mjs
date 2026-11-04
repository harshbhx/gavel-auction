#!/usr/bin/env node
// Fails when a text file contains a non-ASCII character (R-QA-017).
// Usage: node scripts/check-ascii.mjs            whole tree (tracked files)
//        node scripts/check-ascii.mjs a.md b.ts  only the given files (pre-commit)
// Paths listed in .asciiignore are skipped.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadIgnore, readText, selectFiles } from './lib-text-check.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Returns [{line, column, code}] for each non-ASCII character in text. */
export function findNonAscii(text) {
  const found = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (let j = 0; j < line.length; j += 1) {
      const code = line.codePointAt(j);
      if (code > 126 || (code < 32 && code !== 9 && code !== 13)) {
        found.push({ line: i + 1, column: j + 1, code });
      }
      if (code > 0xffff) j += 1;
    }
  }
  return found;
}

export function checkFiles(rootDir, files, ignore) {
  const failures = [];
  for (const file of files) {
    const normal = file.replace(/\\/g, '/').replace(/^\.\//, '');
    if (ignore.some((re) => re.test(normal))) continue;
    const text = readText(rootDir, normal);
    if (text === undefined) continue;
    for (const hit of findNonAscii(text)) failures.push({ file: normal, ...hit });
  }
  return failures;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = selectFiles(root, process.argv.slice(2));
  const failures = checkFiles(root, files, loadIgnore(root, '.asciiignore'));
  for (const f of failures) {
    const hex = f.code.toString(16).toUpperCase().padStart(4, '0');
    console.error(`${f.file}:${f.line}:${f.column} non-ASCII character U+${hex}`);
  }
  if (failures.length > 0) {
    console.error(`check:ascii failed: ${failures.length} non-ASCII character(s)`);
    process.exit(1);
  }
  console.log(`check:ascii ok (${files.length} files)`);
}
