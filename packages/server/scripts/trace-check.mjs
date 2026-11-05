#!/usr/bin/env node
// Spec traceability for @gavel/server (RT-63).
//   node scripts/trace-check.mjs [--spec <file>] [--tests <dir>] [--allow <file>|none]
//                                [--update-allow]
// Every R-RT id of the realtime spec must be covered: named in a test title (describe, it, test)
// or in a test file name, or reached through a T-RT id that the spec ties to it and that a test
// title names. Ids that are uncovered today are listed with a reason in scripts/trace-allow.json.
// Fails (exit 1) on a new uncovered id and on an allowlist entry that is stale (id covered now or
// no longer in the spec).
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(here, '..');
const repoRoot = join(pkgDir, '..', '..');

/** Requirement ids defined by the spec, in file order. */
export function specIds(text) {
  return [...text.matchAll(/^- \*\*(R-RT-\d{3})\*\*/gm)].map((m) => m[1]);
}

/** Map T-RT id -> R-RT ids it verifies, from the spec's test lines. */
export function testMap(text) {
  const map = new Map();
  for (const m of text.matchAll(/^- \*\*(T-RT-\d{3})\*\*[^\n(]*\(([^)\n]*)\)/gm)) {
    map.set(m[1], m[2].match(/R-RT-\d{3}/g) ?? []);
  }
  return map;
}

const TITLE_RE =
  /\b(?:describe|it|test)(?:\.(?:only|skip|concurrent|todo|each))*\s*\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;

/** Titles of the `describe(...)`, `it(...)` and `test(...)` calls in one source text. */
export function testTitles(src) {
  return [...src.matchAll(TITLE_RE)].map((m) => m[2]);
}

function listTests(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTests(p));
    else if (/\.test\.(ts|tsx)$/.test(entry.name)) out.push(p);
  }
  return out.sort();
}

/**
 * Compares the spec with the tests. `tests` is [{file, src}]. `allow` is { id: reason }.
 * Returns { uncovered, stale, allUncovered }.
 */
export function check(specText, tests, allow = {}) {
  const haystack = tests.flatMap((t) => [t.file, ...testTitles(t.src)]).join('\n');
  const tIds = new Set(haystack.match(/T-RT-\d{3}/g) ?? []);
  const viaT = new Set();
  for (const [t, rs] of testMap(specText)) if (tIds.has(t)) for (const r of rs) viaT.add(r);
  const ids = specIds(specText);
  const allUncovered = ids.filter((id) => !haystack.includes(id) && !viaT.has(id));
  const allowed = Object.keys(allow);
  return {
    uncovered: allUncovered.filter((id) => !allowed.includes(id)),
    stale: allowed.filter((id) => !allUncovered.includes(id)),
    allUncovered,
  };
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function main() {
  const specFile = arg('spec') ?? join(repoRoot, 'docs', 'specs', 'realtime', 'SPEC-realtime.md');
  const testsDir = arg('tests') ?? join(pkgDir, 'test');
  const allowArg = arg('allow') ?? join(here, 'trace-allow.json');
  const spec = readFileSync(specFile, 'utf8');
  const tests = listTests(testsDir).map((f) => ({
    file: relative(testsDir, f).split('\\').join('/'),
    src: readFileSync(f, 'utf8'),
  }));
  const allow =
    allowArg === 'none' || !existsSync(allowArg) ? {} : JSON.parse(readFileSync(allowArg, 'utf8'));
  const r = check(spec, tests, allow);
  if (process.argv.includes('--update-allow')) {
    const next = {};
    for (const id of r.allUncovered) next[id] = allow[id] ?? 'not covered by a server test yet';
    writeFileSync(allowArg, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`allowlist written: ${r.allUncovered.length} ids`);
    return 0;
  }
  for (const id of r.uncovered) console.log(`spec id not covered by any server test: ${id}`);
  for (const id of r.stale)
    console.log(`stale allowlist entry (covered now or not in spec): ${id}`);
  if (r.uncovered.length + r.stale.length > 0) return 1;
  console.log(`trace check passed (${tests.length} test files, ${r.allUncovered.length} allowed)`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main());
