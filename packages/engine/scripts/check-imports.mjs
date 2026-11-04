#!/usr/bin/env node
// Import boundary check for @gavel/engine (R-ENG-119, R-ENG-120).
//   node scripts/check-imports.mjs [--src <dir>] [--package <package.json>]
// Fails (exit 1) when a file under src/ outside src/node/ and src/testing/ imports a Node built-in, or when
// package.json declares runtime dependencies.
import { readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// Node-only helpers (src/node) and the fixture loader used by tests (src/testing) may use Node;
// neither is part of the core entry point.
const ALLOWED_DIRS = new Set(['node', 'testing']);
const BUILTINS = new Set(builtinModules.map((m) => m.replace(/^node:/, '')));
const SPECIFIER_RE = /\b(?:from|import|require)\s*\(?\s*(['"`])([^'"`]+)\1/g;

function sources(dir, root) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!ALLOWED_DIRS.has(relative(root, p).split('\\').join('/'))) out.push(...sources(p, root));
    } else if (/\.(ts|tsx|mjs|js)$/.test(entry.name)) out.push(p);
  }
  return out;
}

/** True when a module specifier names a Node built-in, with or without the `node:` prefix. */
export function isNodeBuiltin(spec) {
  if (spec.startsWith('node:')) return true;
  return BUILTINS.has(spec.split('/')[0]) && !spec.startsWith('.');
}

/** Problems found in the source files of one directory (src/node/ is allowed to use Node). */
export function checkSources(srcDir) {
  const problems = [];
  for (const file of sources(srcDir, srcDir)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(SPECIFIER_RE)) {
      if (isNodeBuiltin(m[2])) {
        problems.push(`${relative(srcDir, file)}: imports Node built-in "${m[2]}"`);
      }
    }
  }
  return problems;
}

/** Problems found in a package.json: any runtime dependency is one (R-ENG-119). */
export function checkPackage(pkg) {
  const problems = [];
  for (const key of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    const names = Object.keys(pkg[key] ?? {});
    if (names.length > 0) problems.push(`package.json ${key} must be empty: ${names.join(', ')}`);
  }
  return problems;
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function main() {
  const srcDir = arg('src') ?? join(here, '..', 'src');
  const pkgFile = arg('package') ?? join(here, '..', 'package.json');
  const problems = [
    ...checkSources(srcDir),
    ...checkPackage(JSON.parse(readFileSync(pkgFile, 'utf8'))),
  ];
  for (const p of problems) console.log(p);
  if (problems.length > 0) return 1;
  console.log('import boundary check passed');
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main());
