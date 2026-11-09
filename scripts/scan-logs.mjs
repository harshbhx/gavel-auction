#!/usr/bin/env node
// SEC-15 log scanner (issue 2188). Scans server output for seeded canary secrets and for
// secret-shaped patterns. The canary values are read from environment variables whose NAMES are
// given on the command line; a value is never printed or written to the report, only the name of
// the canary, the file and the line number of a hit.
//
// Usage:
//   node scripts/scan-logs.mjs --log server.log [--log other.log] [--store DIR]
//     --canary NAME[,NAME...]  environment variables that hold canary values
//     --min-lines N            fail when the logs hold fewer lines (an empty log proves nothing)
//     --out report.json        write the report (counts and positions only)
//   Exit 0 clean, 1 findings or too few lines, 2 bad usage.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Shortest canary we accept: a shorter one would match ordinary words. */
export const MIN_CANARY_CHARS = 16;

const PATTERNS = [
  {
    rule: 'bearer-token',
    // The server writes "[redacted]" in place of a token, which this class does not match.
    re: /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g,
  },
  {
    rule: 'jwt-shape',
    re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g,
  },
  {
    rule: 'signed-token-shape',
    // base64url payload, a dot, base64url signature: the shape of the app's own tokens.
    re: /\b[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}\b/g,
  },
  {
    rule: 'authorization-header',
    re: /authorization["']?\s*[:=]\s*["']?(?!\[redacted\])[^\s"',}]{4,}/gi,
  },
  {
    rule: 'email-address',
    re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
  },
];

/** Luhn checksum of a string of digits. */
export function luhn(digits) {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

/**
 * A 13 digit number from 1.5e12 to 2e12 is an epoch time in milliseconds, which the logs carry in
 * every line; it is not a card number even when it happens to pass the checksum.
 */
function isEpochMs(digits) {
  return digits.length === 13 && digits >= '1500000000000' && digits < '2000000000000';
}

/** Card-number-shaped runs: 13 to 19 digits that pass Luhn (spaces and dashes inside allowed). */
export function cardCandidates(line) {
  const out = [];
  const re = /(?<![\dA-Za-z])\d(?:[ -]?\d){12,18}(?![\dA-Za-z])/g;
  for (const m of line.matchAll(re)) {
    const digits = m[0].replace(/[ -]/g, '');
    if (digits.length < 13 || digits.length > 19) continue;
    if (isEpochMs(digits)) continue;
    if (/^(\d)\1+$/.test(digits)) continue;
    if (luhn(digits)) out.push(digits);
  }
  return out;
}

/** Fingerprint of a matched value: 8 hex characters of its sha256, never the value. */
function fingerprint(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 8);
}

/**
 * Scans one text. `canaries` is a list of { name, value }. `patterns` false limits the scan to the
 * canaries (used for the data folder, where tokens and names are stored on purpose).
 * Returns findings: { rule, line, name?, fingerprint } with no value in them.
 */
export function scanText(text, canaries, { patterns = true } = {}) {
  const findings = [];
  const usable = canaries.filter(
    (c) => typeof c.value === 'string' && c.value.length >= MIN_CANARY_CHARS,
  );
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (line === '') return;
    for (const c of usable) {
      // Check the raw line and the JSON-escaped form, the way a value sits inside a log record.
      const escaped = JSON.stringify(c.value).slice(1, -1);
      if (line.includes(c.value) || line.includes(escaped)) {
        findings.push({
          rule: 'canary',
          name: c.name,
          line: i + 1,
          fingerprint: fingerprint(c.value),
        });
      }
    }
    if (!patterns) return;
    for (const { rule, re } of PATTERNS) {
      for (const m of line.matchAll(re)) {
        findings.push({ rule, line: i + 1, fingerprint: fingerprint(m[0]) });
      }
    }
    for (const digits of cardCandidates(line)) {
      findings.push({ rule: 'card-number-shape', line: i + 1, fingerprint: fingerprint(digits) });
    }
  });
  return { lines: lines.filter((l) => l !== '').length, findings };
}

/** Counts findings by rule. */
export function countByRule(findings) {
  const counts = {};
  for (const f of findings) counts[f.rule] = (counts[f.rule] ?? 0) + 1;
  return counts;
}

/** Reads canaries from the environment: names in, { name, value } out; missing ones are reported. */
export function readCanaries(names, env) {
  const canaries = [];
  const missing = [];
  for (const name of names) {
    const value = env[name];
    if (typeof value !== 'string' || value.length < MIN_CANARY_CHARS) missing.push(name);
    else canaries.push({ name, value });
  }
  return { canaries, missing };
}

const MAX_STORE_FILE_BYTES = 5 * 1024 * 1024;

/** Text files under a folder (a store or data folder), skipping very large ones. */
export function listTextFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (st.size <= MAX_STORE_FILE_BYTES) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * Builds the whole report from log files and store files already read.
 * inputs: [{ path, text, kind: 'log' | 'store' }]
 */
export function buildReport({ inputs, canaries, missingCanaries, minLines }) {
  const files = [];
  let logLines = 0;
  const all = [];
  for (const input of inputs) {
    const { lines, findings } = scanText(input.text, canaries, { patterns: input.kind === 'log' });
    if (input.kind === 'log') logLines += lines;
    files.push({
      path: input.path,
      kind: input.kind,
      lines,
      sha256: createHash('sha256').update(input.text).digest('hex'),
      findings: findings.length,
    });
    for (const f of findings) all.push({ file: input.path, ...f });
  }
  const problems = [];
  if (missingCanaries.length > 0) problems.push(`canary not set: ${missingCanaries.join(', ')}`);
  if (logLines < minLines) problems.push(`only ${logLines} log lines, need at least ${minLines}`);
  if (all.length > 0) problems.push(`${all.length} finding(s)`);
  const verdict = problems.length === 0 ? 'PASS' : 'FAIL';
  return {
    schema: 'sec15-log-scan/1',
    verdict,
    problems,
    canaries: canaries.map((c) => c.name),
    logLines,
    countsByRule: countByRule(all),
    files,
    findings: all,
    notCovered: [
      'raw audio transcripts: scenario S01 sends no audio, so no private transcript was injected',
      'any log line the server wrote that this run did not exercise (other routes, error paths)',
    ],
  };
}

function usage(msg) {
  process.stderr.write(
    `${msg}\nusage: scan-logs.mjs --log FILE [--store DIR] --canary NAME[,NAME] [--min-lines N] [--out FILE]\n`,
  );
  return 2;
}

export function parseArgs(argv) {
  const args = { logs: [], stores: [], canaryNames: [], minLines: 1, out: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const v = argv[i + 1];
    if (
      a === '--log' ||
      a === '--store' ||
      a === '--canary' ||
      a === '--min-lines' ||
      a === '--out'
    ) {
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
      i += 1;
      if (a === '--log') args.logs.push(v);
      else if (a === '--store') args.stores.push(v);
      else if (a === '--canary') args.canaryNames.push(...v.split(',').filter((n) => n !== ''));
      else if (a === '--min-lines') {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 0) throw new Error('--min-lines needs a whole number');
        args.minLines = n;
      } else args.out = v;
    } else throw new Error(`unknown argument ${a}`);
  }
  if (args.logs.length === 0) throw new Error('at least one --log is needed');
  if (args.canaryNames.length === 0) throw new Error('at least one --canary is needed');
  return args;
}

export function main(argv, env = process.env) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    return usage(e.message);
  }
  const inputs = [];
  for (const p of args.logs) inputs.push({ path: p, kind: 'log', text: readFileSync(p, 'utf8') });
  for (const dir of args.stores) {
    for (const p of listTextFiles(dir)) {
      inputs.push({
        path: join('store', relative(resolve(dir), p)),
        kind: 'store',
        text: readFileSync(p, 'utf8'),
      });
    }
  }
  const { canaries, missing } = readCanaries(args.canaryNames, env);
  const report = buildReport({
    inputs,
    canaries,
    missingCanaries: missing,
    minLines: args.minLines,
  });
  if (args.out !== undefined) writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    `SEC-15 LOG SCAN VERDICT: ${report.verdict} (${report.logLines} log lines, ${report.findings.length} findings, ${report.canaries.length} canaries${report.problems.length > 0 ? `; ${report.problems.join('; ')}` : ''})\n`,
  );
  return report.verdict === 'PASS' ? 0 : 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
