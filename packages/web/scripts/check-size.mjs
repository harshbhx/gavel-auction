#!/usr/bin/env node
/**
 * Bundle gate for the web app (R-WEB-009, T-WEB-057), run after `npm run build -w @gavel/web`.
 *
 * Walks the initial route: the scripts and preloads in dist/index.html, everything they import
 * statically, and the chunks the entry loads with a dynamic import() on boot (main.tsx loads the
 * whole app with import('./App'), so the App chunk is part of a first visit). Dynamic imports found
 * in the App chunk itself are the lazy chunks and are not followed. The gate sums the gzip size of
 * that JS and fails when it is over 190 KB. It also fails when the PayPal SDK loader, the QR
 * encoder, the replay player or AG Grid is part of that initial graph: those must be lazy chunks.
 * The lazy AG Grid chunk (assets/ag-grid-*.js, named by the Vite config) has its own budget: its gzip
 * size must stay under 320 KB, so a module added by accident shows up here.
 * It also checks that index.html ships a Content-Security-Policy with
 * no inline script allowance (R-WEB-004).
 *
 * Usage: node packages/web/scripts/check-size.mjs [distDir]
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

// 190 KB: the first-route copy and features of the UI wave (9 Nov) legitimately outgrew the old 180 KB (FIX-107).
const LIMIT_BYTES = 190 * 1000;

/** Budget for the lazy AG Grid chunk, gzip. Only the modules the grids use are registered. */
export const GRID_LIMIT_BYTES = 320 * 1000;

/** What must stay out of the initial route: a chunk file name pattern or a string only it holds. */
const LAZY = [
  // The PayPal SDK itself is a script loaded from PayPal's origin on the approval step and is never
  // bundled; what must not land in the initial route is a chunk that carries it.
  { name: 'PayPal SDK', file: /paypal-?sdk|paypal\.js|paypal-/i, text: null },
  { name: 'QR encoder', file: /qrcode/i, text: 'url too long for the QR renderer' },
  { name: 'replay player', file: /replay/i, text: null },
  // Markers of the AG Grid bundle (audit grid): a chunk named after it, or its licence manager.
  { name: 'AG Grid', file: /ag-?grid/i, text: 'ag-grid-community' },
];

/**
 * Static import specifiers of a built chunk, also in minified form (`import{a as b}from"./x.js"`,
 * no space before from). Dynamic import( ) calls are not matched.
 */
export function staticImports(code) {
  const found = [];
  const pattern = /(?:^|[;}\s])(?:import|export)\s*(?:[^'"()]*?\bfrom\s*)?["']([^"']+)["']/g;
  for (const match of code.matchAll(pattern)) {
    if (match[1] !== undefined && match[1].startsWith('.')) found.push(match[1]);
  }
  return found;
}

/** Specifiers of dynamic import("./chunk.js") calls with a literal path. */
export function dynamicImports(code) {
  const found = [];
  for (const match of code.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
    if (match[1] !== undefined && match[1].startsWith('.')) found.push(match[1]);
  }
  return found;
}

/** True when a chunk file name belongs to a library that must stay lazy. */
function isLazyName(rel) {
  return LAZY.some((lazy) => lazy.file.test(path.posix.basename(rel)));
}

/** Local script and modulepreload targets of an HTML file. */
export function entriesOf(html) {
  const found = [];
  const pattern = /<(?:script|link)\b[^>]*?(?:src|href)="([^"]+\.js)"[^>]*>/g;
  for (const match of html.matchAll(pattern)) {
    const tag = match[0];
    if (/<link\b/.test(tag) && !/rel="modulepreload"/.test(tag)) continue;
    if (match[1] !== undefined && !/^https?:/.test(match[1])) found.push(match[1]);
  }
  return found;
}

/** The origin of an absolute URL, or null. */
function originOf(value) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * The inline script blocks and the CSP of an HTML file, as problems. When VITE_API_BASE or
 * VITE_WS_BASE is set in env, connect-src must list that origin (R-WEB-004); it never has a wildcard.
 */
export function cspProblems(html, env = process.env) {
  const problems = [];
  const meta = html.match(/<meta\b[^>]*http-equiv="Content-Security-Policy"[^>]*>/i);
  if (meta === null) return ['index.html has no Content-Security-Policy meta tag'];
  const content = meta[0].match(/content="([^"]*)"/);
  const policy = content?.[1] ?? '';
  const script = policy.split(';').find((d) => d.trim().startsWith('script-src')) ?? '';
  if (script === '') problems.push('CSP has no script-src directive');
  if (/'unsafe-inline'|'unsafe-eval'/.test(script))
    problems.push('CSP script-src allows unsafe code');
  const connect = policy.split(';').find((d) => d.trim().startsWith('connect-src'));
  if (connect === undefined) {
    problems.push('CSP has no connect-src directive');
  } else {
    const sources = connect.trim().split(/\s+/).slice(1);
    if (sources.some((source) => source.includes('*')))
      problems.push('CSP connect-src has a wildcard origin');
    for (const name of ['VITE_API_BASE', 'VITE_WS_BASE']) {
      const origin = originOf(env[name] ?? '');
      if (origin !== null && !sources.includes(origin))
        problems.push(`CSP connect-src does not allow ${name} origin ${origin}`);
    }
  }
  if (/<script(?![^>]*\bsrc=)[^>]*>\s*\S/i.test(html))
    problems.push('index.html has an inline script');
  return problems;
}

/**
 * Loads the initial graph from dist. Returns Map(rel -> code). Static imports are followed
 * everywhere. Dynamic imports are followed only from the entry files (the scripts of index.html and
 * their static imports), which is how main.tsx boots the app; a dynamic import from the App chunk
 * or deeper is a lazy chunk and stays out. A dynamic target that is a known lazy chunk is skipped.
 */
export function initialGraph(dist, html) {
  const files = new Map();
  const queue = entriesOf(html).map((e) => ({
    rel: path.posix.normalize(e.replace(/^\//, '')),
    entry: true,
  }));
  while (queue.length > 0) {
    const item = queue.pop();
    if (item === undefined) continue;
    const { rel, entry } = item;
    if (files.has(rel)) continue;
    const abs = path.join(dist, rel);
    if (!existsSync(abs)) throw new Error(`missing file in build output: ${rel}`);
    const code = readFileSync(abs, 'utf8');
    files.set(rel, code);
    const dir = path.posix.dirname(rel);
    for (const spec of staticImports(code)) {
      queue.push({ rel: path.posix.join(dir, spec), entry });
    }
    if (entry) {
      for (const spec of dynamicImports(code)) {
        const target = path.posix.join(dir, spec);
        if (!isLazyName(target)) queue.push({ rel: target, entry: false });
      }
    }
  }
  return files;
}

/** The AG Grid chunk files in dist/assets, with their gzip size. */
export function gridChunks(dist) {
  const dir = path.join(dist, 'assets');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => /^ag-grid-.*\.js$/.test(name))
    .map((name) => ({ name, bytes: gzipSync(readFileSync(path.join(dir, name))).length }));
}

export function check(dist) {
  const indexPath = path.join(dist, 'index.html');
  if (!existsSync(indexPath))
    return {
      problems: [`no build output at ${dist}; run the build first`],
      bytes: 0,
      gridBytes: 0,
      gridFiles: 0,
    };
  const html = readFileSync(indexPath, 'utf8');
  const problems = cspProblems(html);
  const files = initialGraph(dist, html);
  let bytes = 0;
  for (const [rel, code] of files) {
    bytes += gzipSync(code).length;
    for (const lazy of LAZY) {
      const byName = lazy.file.test(path.posix.basename(rel));
      const byText = lazy.text !== null && code.includes(lazy.text);
      if (byName || byText) {
        // Name the chunks that mention this one, so the import that pulls it in is easy to find.
        const base = path.posix.basename(rel);
        const via = [...files]
          .filter(([other, otherCode]) => other !== rel && otherCode.includes(base))
          .map(([other]) => other);
        const note = via.length === 0 ? '' : `, referenced by ${via.join(', ')}`;
        problems.push(
          `${lazy.name} is in the initial route (${rel}${note}); it must be a lazy chunk`,
        );
      }
    }
  }
  if (bytes > LIMIT_BYTES)
    problems.push(`initial route is ${bytes} bytes gzip, over the ${LIMIT_BYTES} limit`);
  const chunks = gridChunks(dist);
  const gridBytes = chunks.reduce((sum, c) => sum + c.bytes, 0);
  if (gridBytes > GRID_LIMIT_BYTES)
    problems.push(`AG Grid chunk is ${gridBytes} bytes gzip, over the ${GRID_LIMIT_BYTES} budget`);
  return { problems, bytes, gridBytes, gridFiles: chunks.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dist = path.resolve(
    process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist'),
  );
  const { problems, bytes, gridBytes, gridFiles } = check(dist);
  // A real build always has the named chunk; without it the budget above would pass by default.
  if (gridFiles === 0 && existsSync(path.join(dist, 'index.html')))
    problems.push(
      'no ag-grid-*.js chunk in the build: the Vite config must name the AG Grid chunk',
    );
  if (problems.length > 0) {
    for (const p of problems) console.error(`check:size ${p}`);
    process.exit(1);
  }
  console.log(
    `check:size ok (initial route ${bytes} bytes gzip, limit ${LIMIT_BYTES}; AG Grid chunk ${gridBytes} bytes gzip, budget ${GRID_LIMIT_BYTES})`,
  );
}
