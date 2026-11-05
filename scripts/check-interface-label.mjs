#!/usr/bin/env node
// Interface policy for exported package symbols (R-QA-014).
//
//   --generate   rebuild the api-extractor report of every package into etc/<package>.api.md
//   --check      fail when a report changed and the pull request has no `interface` label
//
// Merge order: an interface pull request (label `interface`, updated reports in etc/) merges
// first; pull requests that depend on the new symbols merge afterwards and never change a
// report themselves. Inputs for --check: --labels or PR_LABELS (comma separated), and the
// working tree, which must hold freshly generated reports compared against HEAD.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const PACKAGES = ['shared', 'engine', 'payments', 'voice', 'server', 'web', 'e2e'];
export const LABEL = 'interface';

/** Pure decision: which report files changed, which labels are on the pull request. */
export function evaluate(changedReports, labels) {
  const has = labels.map((l) => l.trim().toLowerCase()).includes(LABEL);
  if (changedReports.length === 0) return { ok: true, message: 'no API report changed' };
  if (has) {
    return {
      ok: true,
      message: `API report changed (${changedReports.join(', ')}), label present`,
    };
  }
  return {
    ok: false,
    message: `API report changed (${changedReports.join(', ')}) but the pull request has no "${LABEL}" label`,
  };
}

function entryFor(pkg) {
  return pkg === 'web' ? 'src/App.tsx' : 'src/index.ts';
}

/** Emit declarations for the files of one package only, using the TypeScript compiler API. */
function emitDeclarations(ts, pkg, outDir) {
  const pkgDir = join(root, 'packages', pkg);
  const srcDir = join(pkgDir, 'src');
  const options = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    strict: true,
    skipLibCheck: true,
    declaration: true,
    emitDeclarationOnly: true,
    noEmitOnError: false,
    types: [],
    rootDir: srcDir,
    outDir,
  };
  const host = ts.createCompilerHost(options);
  const program = ts.createProgram([join(pkgDir, entryFor(pkg))], options, host);
  const inside = (f) => !relative(srcDir, f).startsWith('..') && !f.endsWith('.d.ts');
  for (const sf of program.getSourceFiles()) {
    if (inside(resolve(sf.fileName))) {
      program.emit(sf, writeDeclaration, undefined, true, undefined, true);
    }
  }
}

/**
 * api-extractor cannot follow a computed key whose symbol is not exported, which is how the
 * branded types are written (`[centsBrand]`). The temporary declaration spells the brand as a
 * plain property instead; the committed report then shows the same public surface.
 */
export function simplifyBrands(text) {
  const names = [...text.matchAll(/^declare const (\w+): unique symbol;\r?\n/gm)].map((m) => m[1]);
  let out = text.replace(/^declare const \w+: unique symbol;\r?\n/gm, '');
  for (const name of names) out = out.split(`[${name}]`).join(`__brand_${name}`);
  return out;
}

function writeDeclaration(fileName, text) {
  mkdirSync(dirname(fileName), { recursive: true });
  writeFileSync(fileName, simplifyBrands(text));
}

async function generate() {
  const require = createRequire(import.meta.url);
  const ts = require('typescript');
  const { Extractor, ExtractorConfig } = await import(
    pathToFileURL(require.resolve('@microsoft/api-extractor')).href
  );
  const baseFile = join(root, 'api-extractor.json');
  const base = ExtractorConfig.loadFile(baseFile);
  // The package under analysis lives outside node_modules (so it is analysed, not treated as an
  // external library); the packages it imports live inside node_modules and stay external.
  const own = join(root, '.api-types');
  const cache = join(root, 'node_modules', '.cache', 'api-types');
  rmSync(own, { recursive: true, force: true });
  rmSync(cache, { recursive: true, force: true });
  mkdirSync(join(root, 'etc'), { recursive: true });
  const mainOf = (dir, pkg) =>
    join(
      dir,
      pkg,
      entryFor(pkg)
        .replace(/^src\//, '')
        .replace(/\.tsx?$/, '.d.ts'),
    );
  for (const pkg of PACKAGES) {
    for (const dir of [own, cache]) {
      mkdirSync(join(dir, pkg), { recursive: true });
      emitDeclarations(ts, pkg, join(dir, pkg));
    }
  }
  // Workspace packages resolve to their emitted declarations, so they stay external imports.
  const paths = Object.fromEntries(
    PACKAGES.map((p) => [`@gavel/${p}`, [mainOf(cache, p).split(sep).join('/')]]),
  );
  const compiler = {
    overrideTsconfig: {
      compilerOptions: { ...base.compiler.overrideTsconfig.compilerOptions, paths },
    },
  };
  let failed = false;
  for (const pkg of PACKAGES) {
    const configObject = {
      ...base,
      compiler,
      projectFolder: join(root, 'packages', pkg),
      mainEntryPointFilePath: mainOf(own, pkg),
      apiReport: { ...base.apiReport, reportFolder: join(root, 'etc') + sep },
    };
    const prepared = ExtractorConfig.prepare({
      configObject,
      configObjectFullPath: baseFile,
      packageJsonFullPath: join(root, 'packages', pkg, 'package.json'),
    });
    let result;
    try {
      result = Extractor.invoke(prepared, { localBuild: true, showVerboseMessages: false });
    } catch (err) {
      process.stderr.write(`api-extractor failed for ${pkg}\n`);
      const dbg = join(own, pkg, 'money.d.ts');
      if (existsSync(dbg)) process.stderr.write(`${readFileSync(dbg, 'utf8')}\n`);
      throw err;
    }
    if (!result.succeeded) failed = true;
  }
  rmSync(own, { recursive: true, force: true });
  return failed ? 1 : 0;
}

function changedReports() {
  const out = execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', 'etc'], {
    cwd: root,
    encoding: 'utf8',
  });
  return out
    .split('\n')
    .map((l) => l.slice(3).trim())
    .filter((l) => l.endsWith('.api.md'));
}

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  if (process.argv.includes('--generate')) return generate();
  if (process.argv.includes('--check')) {
    const raw = argValue('--labels') ?? process.env.PR_LABELS ?? '';
    const labels = raw.split(',').filter((l) => l.trim() !== '');
    const missing = PACKAGES.filter((p) => !existsSync(join(root, 'etc', `${p}.api.md`)));
    if (missing.length > 0) {
      process.stdout.write(`missing API reports: ${missing.join(', ')}\n`);
      return 1;
    }
    const verdict = evaluate(changedReports(), labels);
    process.stdout.write(`${verdict.message}\n`);
    return verdict.ok ? 0 : 1;
  }
  process.stdout.write('usage: check-interface-label.mjs --generate | --check [--labels a,b]\n');
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
      process.exit(1);
    },
  );
}
