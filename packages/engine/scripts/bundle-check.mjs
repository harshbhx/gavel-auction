#!/usr/bin/env node
// Bundles the core entry point for browsers with esbuild and fails on any Node built-in (R-ENG-120).
//   node scripts/bundle-check.mjs [--entry <file>]
import { builtinModules } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const BUILTINS = new Set(builtinModules.map((m) => m.replace(/^node:/, '')));

/** True when a module specifier names a Node built-in, with or without the `node:` prefix. */
export function isNodeBuiltin(spec) {
  return spec.startsWith('node:') || (!spec.startsWith('.') && BUILTINS.has(spec.split('/')[0]));
}

/** Bundles one entry for the browser; returns problems and the bundle size in bytes. */
export function bundleCheck(entry) {
  let result;
  try {
    result = buildSync({
      entryPoints: [entry],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      metafile: true,
      logLevel: 'silent',
    });
  } catch (e) {
    const msgs = (e.errors ?? []).map((m) => m.text);
    return { problems: msgs.length > 0 ? msgs : [String(e.message)], bytes: 0 };
  }
  const problems = [];
  for (const [file, meta] of Object.entries(result.metafile.inputs)) {
    for (const imp of meta.imports) {
      if (isNodeBuiltin(imp.path)) problems.push(`${file}: imports Node built-in "${imp.path}"`);
    }
  }
  return { problems, bytes: result.outputFiles[0].contents.length };
}

function main() {
  const i = process.argv.indexOf('--entry');
  const entry = i === -1 ? join(here, '..', 'src', 'index.ts') : process.argv[i + 1];
  const { problems, bytes } = bundleCheck(entry);
  for (const p of problems) console.log(p);
  if (problems.length > 0) return 1;
  console.log(`browser bundle ok (${bytes} bytes, no node: imports)`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main());
