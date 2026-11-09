#!/usr/bin/env node
// JavaScript budget for the docs site. Sums the gzip size of every script the page loads
// (script src and preload links in the exported HTML) for the home page and one docs page,
// prints each total and fails when one is over its limit. Plain node, no build, runs in the build job.
// Usage: node scripts/check-size.mjs [export-dir]
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const dir = process.argv[2] ?? 'out';

// Limits in bytes of gzip JS that a modern browser loads (the noModule polyfill bundle is not counted).
// Measured on main with search on demand: home 335,223 and docs page 394,388, both including 39 KB of noModule
// polyfills, so about 296,000 and 355,000 without them. Updated below after the motion split.
// Raise one only with a reason in the pull request; lower it when the size drops.
const budgets = [
  { page: 'index.html', label: 'home', limit: Number(process.env.JS_BUDGET_HOME ?? 345_000) },
  { page: 'docs/start.html', label: 'docs page', limit: Number(process.env.JS_BUDGET_DOCS ?? 405_000) },
];

let failed = false;
for (const { page, label, limit } of budgets) {
  const file0 = existsSync(join(dir, page)) ? join(dir, page) : join(dir, page.replace(/\.html$/, '/index.html'));
  const html = readFileSync(file0, 'utf8');
  const srcs = new Set();
  // Scripts marked noModule are the legacy polyfill bundle; browsers that run modules never fetch it.
  for (const m of html.matchAll(/<script\b[^>]*>/g)) {
    const src = /\ssrc="([^"]+\.js[^"]*)"/.exec(m[0]);
    if (src && !/\snomodule\b/i.test(m[0])) srcs.add(src[1]);
  }
  for (const m of html.matchAll(/<link[^>]*rel="preload"[^>]*as="script"[^>]*href="([^"]+)"/g)) srcs.add(m[1]);
  for (const m of html.matchAll(/<link[^>]*href="([^"]+\.js[^"]*)"[^>]*as="script"/g)) srcs.add(m[1]);
  let total = 0;
  let orama = false;
  const rows = [];
  for (const src of srcs) {
    const file = join(dir, src.split('?')[0].replace(/^\//, ''));
    const raw = readFileSync(file);
    const gz = gzipSync(raw, { level: 9 }).length;
    if (/orama/i.test(raw.toString('utf8'))) orama = true;
    total += gz;
    rows.push([gz, src]);
  }
  rows.sort((a, b) => b[0] - a[0]);
  console.log(`${label} (${page}): ${srcs.size} scripts, ${total} bytes gzip, limit ${limit}`);
  for (const [gz, src] of rows.slice(0, 5)) console.log(`  ${gz}  ${src}`);
  if (total > limit) {
    console.error(`FAIL ${label}: ${total} bytes gzip JS is over the budget of ${limit}`);
    failed = true;
  }
  if (orama) {
    console.error(`FAIL ${label}: the search engine (orama) is loaded with the page; it must load on demand`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
