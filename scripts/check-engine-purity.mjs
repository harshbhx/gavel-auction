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

// Patterns run on code with comments removed and string contents blanked, so a URL inside a
// string neither hides nor creates a hit.
const FORBIDDEN = [
  { re: /\bDate\s*\.\s*now\b/, label: 'Date.now' },
  { re: /\bMath\s*\.\s*random\b/, label: 'Math.random' },
  { re: /\bnew\s+Date\b/, label: 'new Date' },
  { re: /(?<![.\w])Date\s*\(/, label: 'Date()' },
  { re: /\bperformance\s*\.\s*(?:now|timeOrigin)\b/, label: 'performance.now' },
  {
    re: /\bcrypto\s*\.\s*(?:randomUUID|getRandomValues|randomBytes|randomInt)\b/,
    label: 'crypto random',
  },
  {
    re: /\{[^}]*\b(?:now|random|randomUUID|getRandomValues)\b[^}]*\}\s*=\s*(?:Date|Math|crypto|performance)\b/,
    label: 'destructured clock or random',
  },
  { re: /\b(?:setTimeout|setInterval|setImmediate|queueMicrotask)\s*\(/, label: 'timer' },
  { re: /\bIntl\s*\.\s*DateTimeFormat\b/, label: 'Intl.DateTimeFormat' },
];
// Patterns that need string contents: bracket access and module specifiers.
const FORBIDDEN_WITH_STRINGS = [
  {
    re: /\b(?:Date|Math|crypto|performance)\s*\[\s*['"`](?:now|random|randomUUID|getRandomValues|timeOrigin)['"`]\s*\]/,
    label: 'bracket access to clock or random',
  },
  {
    re: /\b(?:from|import|require)\s*\(?\s*['"`](?:node:)?(?:crypto|perf_hooks|timers|timers\/promises)['"`]/,
    label: 'crypto, perf_hooks or timers import',
  },
];

/** Removes comments and returns [code with strings kept, code with string contents blanked]. */
export function stripSource(src) {
  let kept = '';
  let blank = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i += 1;
    } else if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      for (; i < stop; i += 1) {
        if (src[i] === '\n') {
          kept += '\n';
          blank += '\n';
        }
      }
    } else if (c === '"' || c === "'" || c === '`') {
      kept += c;
      blank += c;
      i += 1;
      while (i < n && src[i] !== c) {
        if (src[i] === '\\' && i + 1 < n) {
          kept += src[i] + src[i + 1];
          blank += '  ';
          i += 2;
          continue;
        }
        if (src[i] === '\n' && c !== '`') break;
        kept += src[i];
        blank += src[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      if (i < n && src[i] === c) {
        kept += c;
        blank += c;
        i += 1;
      }
    } else {
      kept += c;
      blank += c;
      i += 1;
    }
  }
  return [kept, blank];
}

export function scanSource(src) {
  const [kept, blank] = stripSource(src);
  const keptLines = kept.split('\n');
  const blankLines = blank.split('\n');
  const hits = [];
  blankLines.forEach((line, i) => {
    for (const { re, label } of FORBIDDEN) if (re.test(line)) hits.push({ line: i + 1, label });
  });
  keptLines.forEach((line, i) => {
    for (const { re, label } of FORBIDDEN_WITH_STRINGS)
      if (re.test(line)) hits.push({ line: i + 1, label });
  });
  return hits;
}

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
    for (const h of scanSource(readFileSync(file, 'utf8'))) {
      hits.push(`${relative(root, file).split(sep).join('/')}:${h.line}: ${h.label}`);
    }
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
