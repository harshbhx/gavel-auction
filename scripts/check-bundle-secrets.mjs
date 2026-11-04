#!/usr/bin/env node
// Scans a built bundle directory (default packages/web/dist) and optional log files for
// secret env names assigned a value, and for token-like strings in logs.
// Usage: node scripts/check-bundle-secrets.mjs [--dir <path>] [--logs <file>...] [--self-test]
// A missing directory or file is skipped, so the check passes before those packages exist.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENV_NAMES = [
  'PAYPAL_CLIENT_SECRET',
  'PAYPAL_WEBHOOK_ID',
  'DEEPGRAM_API_KEY',
  'GROQ_API_KEY',
  'LLM_API_KEY',
  'ADMIN_TOKEN',
  'AUCTIONEER_TOKEN_SECRET',
  'DATABASE_URL',
];
const ENV_WITH_VALUE = new RegExp(
  `\\b(${ENV_NAMES.join('|')})\\b\\s*["']?\\s*[:=]\\s*["']?[^\\s"',;}]+`,
  'g',
);
const TOKEN_LIKE = [
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/g,
  /["']?access_token["']?\s*[:=]\s*["'][^"']{8,}/g,
  /\bA21[A-Za-z0-9_-]{30,}/g,
];

export function scanText(text, { logs = false } = {}) {
  const findings = [];
  for (const m of text.matchAll(ENV_WITH_VALUE)) findings.push(`env name with value: ${m[1]}`);
  if (logs) {
    for (const re of TOKEN_LIKE) {
      for (const m of text.matchAll(re))
        findings.push(`token-like string: ${m[0].slice(0, 12)}...`);
    }
  }
  return findings;
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

function selfTest() {
  const cases = [
    ['planted env value caught', scanText('x={PAYPAL_CLIENT_SECRET:"abc123def"}').length > 0],
    ['bare env name passes', scanText('const k = "PAYPAL_CLIENT_SECRET";').length === 0],
    ['clean text passes', scanText('console.log("hello")').length === 0],
    [
      'log bearer token caught',
      scanText('Authorization: Bearer abcdefghijklmnop1234', { logs: true }).length > 0,
    ],
    ['log without token passes', scanText('{"msg":"bid accepted"}', { logs: true }).length === 0],
  ];
  let bad = 0;
  for (const [name, ok] of cases) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
    if (!ok) bad += 1;
  }
  return bad === 0 ? 0 : 1;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) return selfTest();
  let dir = 'packages/web/dist';
  const logs = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--dir') dir = args[(i += 1)];
    else if (args[i] === '--logs') {
      while (args[i + 1] !== undefined && !args[i + 1].startsWith('--')) logs.push(args[(i += 1)]);
    }
  }
  const problems = [];
  if (existsSync(dir)) {
    for (const f of walk(dir)) {
      for (const msg of scanText(readFileSync(f, 'utf8'))) problems.push(`${f}: ${msg}`);
    }
  } else {
    console.log(`bundle dir ${dir} not found, skipped`);
  }
  for (const f of logs) {
    if (!existsSync(f)) continue;
    for (const msg of scanText(readFileSync(f, 'utf8'), { logs: true }))
      problems.push(`${f}: ${msg}`);
  }
  for (const p of problems) console.error(p);
  if (problems.length === 0) console.log('bundle and log scan ok');
  return problems.length === 0 ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main());
}
