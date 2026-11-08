#!/usr/bin/env node
// Turns the `/*` rule of <export>/_headers into <export>/serve.json, so `npx serve` (which ignores
// _headers) answers with the same headers Cloudflare Pages will. Used by the screenshot job in CI.
// Usage: node scripts/write-serve-json.mjs [export-dir]
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'out';
const headers = [];
let inside = false;
for (const line of readFileSync(join(dir, '_headers'), 'utf8').split('\n')) {
  if (line.trim() === '' || line.startsWith('#')) continue;
  if (!line.startsWith(' ')) {
    inside = line.trim() === '/*';
    continue;
  }
  const at = line.indexOf(':');
  if (inside && at > 0) {
    headers.push({ key: line.slice(0, at).trim(), value: line.slice(at + 1).trim() });
  }
}
if (!headers.some((h) => h.key.toLowerCase() === 'content-security-policy')) {
  console.error('no Content-Security-Policy in the /* rule of _headers');
  process.exit(1);
}
writeFileSync(join(dir, 'serve.json'), JSON.stringify({ headers: [{ source: '**', headers }] }));
console.log(`serve.json: ${headers.length} headers`);
