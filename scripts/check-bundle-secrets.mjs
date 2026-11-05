#!/usr/bin/env node
// Scans a built bundle directory (default packages/web/dist) and optional log files for
// secret env names assigned a value, token-like strings, and known canary values.
// Usage: node scripts/check-bundle-secrets.mjs [--dir <path>] [--require-dir]
//        [--canaries-from-env] [--logs <file>...] [--self-test]
// --require-dir fails when the bundle directory is missing (CI builds it first).
// --canaries-from-env treats the value of every secret env name set in this process as a literal
// that must not appear anywhere in the bundle or logs: a bundler inlines a leaked variable as a
// bare string, so the name-with-value pattern alone cannot see it.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ENV_NAMES = [
  'PAYPAL_CLIENT_SECRET',
  'PAYPAL_WEBHOOK_ID',
  'DEEPGRAM_API_KEY',
  'GROQ_API_KEY',
  'LLM_API_KEY',
  'ADMIN_KEY',
  'TOKEN_SECRET',
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

export function scanText(text, { logs = false, canaries = [] } = {}) {
  const findings = [];
  for (const m of text.matchAll(ENV_WITH_VALUE)) findings.push(`env name with value: ${m[1]}`);
  // Token patterns apply to bundles as well as logs: a sandbox access token inlined into
  // dist is as much a leak as one printed to a log.
  for (const re of TOKEN_LIKE) {
    for (const m of text.matchAll(re)) findings.push(`token-like string: ${m[0].slice(0, 12)}...`);
  }
  for (const c of canaries) {
    if (c !== '' && text.includes(c))
      findings.push(`canary secret value present (${c.length} chars)`);
  }
  void logs;
  return findings;
}

export function canariesFromEnv(env) {
  return ENV_NAMES.map((n) => env[n]).filter((v) => typeof v === 'string' && v.length >= 8);
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

function selfTest() {
  // Fake values are assembled at run time so this file holds no secret-shaped literal.
  const fakeValue = ['abc', '123', 'def'].join('');
  const fakeBearer = `Bearer ${'x'.repeat(8)}${'y'.repeat(12)}`;
  const fakePaypal = `A21${'z'.repeat(32)}`;
  const canary = `canary-${'q'.repeat(12)}`;
  const cases = [
    ['planted env value caught', scanText(`x={PAYPAL_CLIENT_SECRET:"${fakeValue}"}`).length > 0],
    ['bare env name passes', scanText('const k = "PAYPAL_CLIENT_SECRET";').length === 0],
    ['clean text passes', scanText('console.log("hello")').length === 0],
    [
      'bearer token caught in a log',
      scanText(`Authorization: ${fakeBearer}`, { logs: true }).length > 0,
    ],
    ['bearer token caught in a bundle', scanText(`h="${fakeBearer}"`).length > 0],
    ['paypal token caught in a bundle', scanText(`t="${fakePaypal}"`).length > 0],
    [
      'inlined canary without its name caught',
      scanText(`a="${canary}"`, { canaries: [canary] }).length > 0,
    ],
    ['absent canary passes', scanText('a="other"', { canaries: [canary] }).length === 0],
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
  const requireDir = args.includes('--require-dir');
  const canaries = args.includes('--canaries-from-env') ? canariesFromEnv(process.env) : [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--dir') dir = args[(i += 1)];
    else if (args[i] === '--logs') {
      while (args[i + 1] !== undefined && !args[i + 1].startsWith('--')) logs.push(args[(i += 1)]);
    }
  }
  const problems = [];
  if (existsSync(dir)) {
    // Read bytes as latin1 so binary assets and source maps are scanned without decoding loss.
    for (const f of walk(dir)) {
      const text = readFileSync(f).toString('latin1');
      for (const msg of scanText(text, { canaries })) problems.push(`${f}: ${msg}`);
    }
  } else if (requireDir) {
    problems.push(`bundle dir ${dir} not found; build it before scanning`);
  } else {
    console.log(`bundle dir ${dir} not found, skipped`);
  }
  for (const f of logs) {
    if (!existsSync(f)) continue;
    for (const msg of scanText(readFileSync(f, 'utf8'), { logs: true, canaries }))
      problems.push(`${f}: ${msg}`);
  }
  for (const p of problems) console.error(p);
  if (problems.length === 0) console.log('bundle and log scan ok');
  return problems.length === 0 ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main());
}
