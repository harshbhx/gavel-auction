#!/usr/bin/env node
// Verifies a ledger export without any server (R-ENG-078).
//   verify-ledger [--head <seq>:<hash>] [--allow-empty] ledger.jsonl
// --head fails a shortened export as truncated; an empty file fails unless --allow-empty is given.
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
  const usage = 'usage: verify-ledger [--head <seq>:<hash>] [--allow-empty] <ledger.jsonl>';
  let expectedHead;
  let allowEmpty = false;
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--allow-empty') allowEmpty = true;
    else if (a === '--head') {
      const m = /^(\d+):([0-9a-f]{64})$/.exec(argv[++i] ?? '');
      if (m === null) {
        console.error(usage);
        return 2;
      }
      expectedHead = { seq: Number(m[1]), hash: m[2] };
    } else files.push(a);
  }
  const file = files[0];
  if (file === undefined || files.length !== 1) {
    console.error(usage);
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
  const r = verifyJsonl(text, expectedHead === undefined ? {} : { expectedHead });
  if (r.ok && r.count === 0 && !allowEmpty) {
    console.log('FAIL empty export: no entries (pass --allow-empty to accept)');
    return 1;
  }
  if (r.ok) {
    console.log(`OK ${r.count} entries`);
    console.log(`head ${r.headHash}`);
    return 0;
  }
  console.log(`FAIL first bad index ${r.firstBadIndex} (line ${r.firstBadIndex + 1}): ${r.reason}`);
  return 1;
}

process.exit(await main(process.argv.slice(2)));
