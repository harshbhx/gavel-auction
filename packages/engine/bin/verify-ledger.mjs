#!/usr/bin/env node
// Verifies a ledger export without any server (R-ENG-078).
//   verify-ledger ledger.jsonl
// Prints the entry count and head hash and exits 0, or prints the first bad index and exits 1.
// The verifier is TypeScript; esbuild bundles src/ledger/export.ts in memory on each run (see D-0019).
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));

async function loadVerifier() {
  const out = buildSync({
    entryPoints: [join(here, '..', 'src', 'ledger', 'export.ts')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
  });
  const code = out.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

async function main(argv) {
  const file = argv[0];
  if (file === undefined || argv.length !== 1) {
    console.error('usage: verify-ledger <ledger.jsonl>');
    return 2;
  }
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    console.error(`cannot read ${file}: ${e.message}`);
    return 2;
  }
  const { verifyJsonl } = await loadVerifier();
  const r = verifyJsonl(text);
  if (r.ok) {
    console.log(`OK ${r.count} entries`);
    console.log(`head ${r.headHash}`);
    return 0;
  }
  console.log(`FAIL first bad index ${r.firstBadIndex} (line ${r.firstBadIndex + 1}): ${r.reason}`);
  return 1;
}

process.exit(await main(process.argv.slice(2)));
