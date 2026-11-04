#!/usr/bin/env node
// Spec traceability for @gavel/engine (R-ENG-124).
//   node scripts/trace-check.mjs [--spec <file>] [--tests <dir>] [--baseline <file>|none]
//                                [--update-baseline]
// Fails (exit 1) when an R-ENG id of the spec is not named in any test title, or when a test
// title has no T-ENG id. Gaps that already existed are listed in scripts/trace-baseline.json;
// only gaps outside that file fail, so the list can shrink but not grow.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(here, '..');
const repoRoot = join(pkgDir, '..', '..');

/** Requirement ids defined by the spec, in file order. */
export function specIds(text) {
  return [...text.matchAll(/^- \*\*(R-ENG-\d{3})\*\*/gm)].map((m) => m[1]);
}

const TITLE_RE =
  /\b(?:it|test)(?:\.(?:only|skip|concurrent|todo))?\s*\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;

/** Titles of the `it(...)` and `test(...)` calls in one source text. */
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
 * Compares the spec with the tests. `tests` is [{file, src}]. Returns
 * { missingIds, untagged } with the gaps that are not in the baseline.
 */
export function check(specText, tests, baseline = { missingIds: [], untagged: [] }) {
  const all = tests.flatMap((t) => testTitles(t.src).map((title) => ({ file: t.file, title })));
  const named = all.map((t) => t.title).join('\n');
  const missingIds = specIds(specText).filter((id) => !named.includes(id));
  const untagged = all
    .filter((t) => !/\bT-ENG-\d{3}\b/.test(t.title))
    .map((t) => `${t.file} :: ${t.title}`);
  return {
    missingIds: missingIds.filter((id) => !baseline.missingIds.includes(id)),
    untagged: untagged.filter((u) => !baseline.untagged.includes(u)),
    allMissingIds: missingIds,
    allUntagged: untagged,
  };
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function defaultSpec() {
  const options = [
    join(repoRoot, 'docs', 'specs', 'engine', 'SPEC-engine.md'),
    join(repoRoot, 'docs', 'specs', 'SPEC-engine.md'),
  ];
  return options.find((p) => existsSync(p)) ?? options[0];
}

function main() {
  const specFile = arg('spec') ?? defaultSpec();
  const testsDir = arg('tests') ?? join(pkgDir, 'test');
  const baselineArg = arg('baseline') ?? join(here, 'trace-baseline.json');
  const spec = readFileSync(specFile, 'utf8');
  const tests = listTests(testsDir).map((f) => ({
    file: relative(testsDir, f).split('\\').join('/'),
    src: readFileSync(f, 'utf8'),
  }));
  const baseline =
    baselineArg === 'none' || !existsSync(baselineArg)
      ? { missingIds: [], untagged: [] }
      : JSON.parse(readFileSync(baselineArg, 'utf8'));
  const r = check(spec, tests, baseline);
  if (process.argv.includes('--update-baseline')) {
    const next = { missingIds: r.allMissingIds, untagged: r.allUntagged };
    writeFileSync(baselineArg, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`baseline written: ${next.missingIds.length} ids, ${next.untagged.length} titles`);
    return 0;
  }
  for (const id of r.missingIds) console.log(`spec id not named in any test title: ${id}`);
  for (const u of r.untagged) console.log(`test title without a T-ENG id: ${u}`);
  if (r.missingIds.length + r.untagged.length > 0) return 1;
  console.log(`trace check passed (${tests.length} test files)`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main());
