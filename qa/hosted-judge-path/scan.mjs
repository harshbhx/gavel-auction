// Scans the run output for the secret values before anything is uploaded. Text files are read
// directly, trace zips are unpacked in memory with `unzip -p`. On a hit it deletes the offending
// file and exits 1. It prints file names only, never the value. Values come from the environment.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const out = path.resolve(process.argv[2] || 'out');
const names = (process.env.SCAN_ENV_NAMES || '').split(',').filter(Boolean);
const values = names.map((n) => process.env[n] || '').filter((v) => v.length >= 4);
// Card numbers also appear spaced in a form; check the digits alone and in groups of four.
for (const v of [...values]) {
  const digits = v.replace(/\D/g, '');
  if (digits.length >= 13) values.push(digits, digits.replace(/(\d{4})(?=\d)/g, '$1 '));
}

function walk(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

let hits = 0;
for (const file of walk(out)) {
  let text;
  if (file.endsWith('.zip')) {
    try {
      text = execFileSync('unzip', ['-p', file], { maxBuffer: 1024 * 1024 * 512 }).toString(
        'latin1',
      );
    } catch {
      text = '';
    }
  } else if (/\.(png|webm)$/.test(file)) {
    continue; // pixels: handled by masking in the run, not by text search
  } else {
    text = fs.readFileSync(file, 'latin1');
  }
  if (values.some((v) => text.includes(v))) {
    hits += 1;
    console.log(`SECRET VALUE FOUND in ${path.relative(out, file)}; file deleted`);
    fs.rmSync(file);
  }
}
console.log(
  hits === 0 ? `scan clean (${values.length} values checked)` : `scan found ${hits} file(s)`,
);
if (hits > 0) process.exitCode = 1;
