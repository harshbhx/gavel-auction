#!/usr/bin/env node
// Fails when engine sources read the wall clock or randomness directly (R-QA-002, T-QA-003).
// The engine receives time through the Clock interface; SystemClock in clock.ts is the single
// adapter that hosts wire in, and test helpers under src/testing are not shipped.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const engineSrc = join(root, 'packages', 'engine', 'src');

const EXEMPT_FILES = new Set(['clock.ts']);
const EXEMPT_DIRS = new Set(['testing']);

const FORBIDDEN = [
  { re: /\bDate\.now\s*\(/, label: 'Date.now(' },
  { re: /\bMath\.random\s*\(/, label: 'Math.random(' },
  { re: /\bnew\s+Date\s*\(/, label: 'new Date(' },
];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!EXEMPT_DIRS.has(name)) yield* walk(full);
    } else if (/\.(ts|tsx|js|mjs|cjs)$/.test(name) && !EXEMPT_FILES.has(name)) {
      yield full;
    }
  }
}

export function findViolations(dir = engineSrc) {
  const hits = [];
  for (const file of walk(dir)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '');
      for (const { re, label } of FORBIDDEN) {
        if (re.test(code)) {
          hits.push(`${relative(root, file).split(sep).join('/')}:${i + 1}: ${label}`);
        }
      }
    });
  }
  return hits;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const hits = findViolations();
  if (hits.length > 0) {
    console.error('engine purity violations:\n  ' + hits.join('\n  '));
    process.exit(1);
  }
  console.log('engine purity: ok');
}
