#!/usr/bin/env node
/**
 * Bundle gate for the web app (R-WEB-009, T-WEB-057), run after `npm run build -w @gavel/web`.
 *
 * Walks the initial route (the scripts and preloads in dist/index.html plus everything they import
 * statically), sums the gzip size of that JS and fails when it is over 180 KB. It also fails when
 * the PayPal SDK loader, the QR encoder or the replay player is part of that initial graph: those
 * three must be lazy chunks. It also checks that index.html ships a Content-Security-Policy with
 * no inline script allowance (R-WEB-004).
 *
 * Usage: node packages/web/scripts/check-size.mjs [distDir]
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const LIMIT_BYTES = 180 * 1000;

/** What must stay out of the initial route: a chunk file name pattern or a string only it holds. */
const LAZY = [
  { name: 'PayPal SDK', file: /paypal/i, text: 'web-sdk/v6/core' },
  { name: 'QR encoder', file: /qrcode/i, text: 'url too long for the QR renderer' },
  { name: 'replay player', file: /replay/i, text: null },
];

/** Static import specifiers of a built chunk. Dynamic import( ) calls are not matched. */
export function staticImports(code) {
  const found = [];
  const pattern = /(?:^|[;}\s])(?:import|export)\s*(?:[^'"()]*?\sfrom\s*)?["']([^"']+)["']/g;
  for (const match of code.matchAll(pattern)) {
    if (match[1] !== undefined && match[1].startsWith('.')) found.push(match[1]);
  }
  return found;
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

/** Loads the initial graph from dist. Returns { files: Map(rel -> code) }. */
export function initialGraph(dist, html) {
  const files = new Map();
  const queue = entriesOf(html).map((e) => path.posix.normalize(e.replace(/^\//, '')));
  while (queue.length > 0) {
    const rel = queue.pop();
    if (rel === undefined || files.has(rel)) continue;
    const abs = path.join(dist, rel);
    if (!existsSync(abs)) throw new Error(`missing file in build output: ${rel}`);
    const code = readFileSync(abs, 'utf8');
    files.set(rel, code);
    for (const spec of staticImports(code)) {
      queue.push(path.posix.join(path.posix.dirname(rel), spec));
    }
  }
  return files;
}

export function check(dist) {
  const indexPath = path.join(dist, 'index.html');
  if (!existsSync(indexPath))
    return { problems: [`no build output at ${dist}; run the build first`], bytes: 0 };
  const html = readFileSync(indexPath, 'utf8');
  const problems = cspProblems(html);
  const files = initialGraph(dist, html);
  let bytes = 0;
  for (const [rel, code] of files) {
    bytes += gzipSync(code).length;
    for (const lazy of LAZY) {
      const byName = lazy.file.test(path.posix.basename(rel));
      const byText = lazy.text !== null && code.includes(lazy.text);
      if (byName || byText)
        problems.push(`${lazy.name} is in the initial route (${rel}); it must be a lazy chunk`);
    }
  }
  if (bytes > LIMIT_BYTES)
    problems.push(`initial route is ${bytes} bytes gzip, over the ${LIMIT_BYTES} limit`);
  return { problems, bytes };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dist = path.resolve(
    process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist'),
  );
  const { problems, bytes } = check(dist);
  if (problems.length > 0) {
    for (const p of problems) console.error(`check:size ${p}`);
    process.exit(1);
  }
  console.log(`check:size ok (initial route ${bytes} bytes gzip, limit ${LIMIT_BYTES})`);
}
