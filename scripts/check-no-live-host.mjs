#!/usr/bin/env node
// Fails when a tracked non-doc file mentions the live PayPal API host (R-QA-038, T-QA-040).
// Usage: node scripts/check-no-live-host.mjs [--self-test]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Built at run time so this file does not contain the string it forbids.
export const LIVE_HOST = ['api-m', 'paypal', 'com'].join('.');

// Files that name the live host on purpose (tests proving the sandbox guard rejects it).
export const ALLOWED = [
  'packages/payments/test/guard.test.ts',
  'scripts/tests/no-live-host.test.mjs',
];

export function isChecked(path) {
  return !path.startsWith('docs/') && !path.endsWith('.md') && !ALLOWED.includes(path);
}

export function scanText(text) {
  return text.includes(LIVE_HOST);
}

function main() {
  if (process.argv.includes('--self-test')) {
    const ok = scanText(`url = "https://${LIVE_HOST}"`) && !scanText('url = "sandbox"');
    return ok && isChecked('packages/web/src/a.ts') && !isChecked('docs/a.txt') ? 0 : 1;
  }
  const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter((f) => f !== '' && isChecked(f));
  const bad = [];
  for (const f of files) {
    let text;
    try {
      text = readFileSync(f).toString('latin1');
    } catch {
      continue;
    }
    if (scanText(text)) bad.push(f);
  }
  for (const f of bad) console.error(`live PayPal host found in ${f}`);
  if (bad.length === 0) console.log(`check:live-host ok (${files.length} files)`);
  return bad.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  process.exit(main());
}
