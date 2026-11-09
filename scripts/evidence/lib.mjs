// Shared pure helpers for the evidence workflows (issues 2183, 2185, 2191). No I/O except
// where a function says so; every number an evidence file holds is computed here from raw
// samples or read from a tool's own output, never typed in.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Nearest-rank percentile of a list of numbers; p in (0, 100]. 0 for an empty list. */
export function percentile(samples, p) {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(sorted.length, rank) - 1];
}

export function round2(n) {
  return Math.round(n * 100) / 100;
}

/** count, min, p50, p95, p99, max of the samples (milliseconds), rounded to 0.01. */
export function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    count: sorted.length,
    min: round2(sorted[0] ?? 0),
    p50: round2(percentile(sorted, 50)),
    p95: round2(percentile(sorted, 95)),
    p99: round2(percentile(sorted, 99)),
    max: round2(sorted[sorted.length - 1] ?? 0),
  };
}

export function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

/** One verdict line, the same shape in every evidence workflow so it can be grepped. */
export function verdictLine(name, verdict, detail = '') {
  const tail = detail === '' ? '' : ` (${detail})`;
  return `${name} VERDICT: ${verdict}${tail}`;
}

/** A GitHub-flavoured markdown table. Cells are stringified; pipes are escaped. */
export function mdTable(headers, rows) {
  const cell = (v) => String(v).replace(/\|/g, '\\|');
  const lines = [
    `| ${headers.map(cell).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
  ];
  for (const r of rows) lines.push(`| ${r.map(cell).join(' | ')} |`);
  return lines.join('\n');
}

/**
 * Names of credential-shaped things found in text: bearer tokens, long unbroken secrets,
 * email addresses and PayPal client-secret-like strings. Evidence is refused when any is found.
 */
export function findSensitive(text) {
  const hits = [];
  // A sha256 digest is 64 hex characters and is not a secret.
  text = text.replace(/\b[0-9a-f]{64}\b/g, 'DIGEST');
  if (/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/.test(text)) hits.push('bearer token');
  if (/[A-Za-z0-9_-]{48,}/.test(text)) hits.push('long token-shaped string');
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(text)) hits.push('email address');
  if (/\bA[A-Za-z0-9_-]{60,}\b/.test(text)) hits.push('client id shaped string');
  return hits;
}

/**
 * Writes `<name>.json`, `<name>.md` and `<name>.sha256` into dir after checking the text for
 * sensitive values. Returns the sha256 of the JSON text. Throws when something sensitive is found.
 */
export function writeEvidence(dir, name, evidence, markdown) {
  const json = `${JSON.stringify(evidence, null, 2)}\n`;
  const hits = [...findSensitive(json), ...findSensitive(markdown)];
  if (hits.length > 0)
    throw new Error(`evidence ${name} holds sensitive values: ${hits.join(', ')}`);
  mkdirSync(dir, { recursive: true });
  const digest = sha256(json);
  writeFileSync(join(dir, `${name}.json`), json);
  writeFileSync(join(dir, `${name}.md`), markdown.endsWith('\n') ? markdown : `${markdown}\n`);
  writeFileSync(join(dir, `${name}.sha256`), `${digest}  ${name}.json\n`);
  return digest;
}

/** Reads a JSON file; undefined when it does not exist or is not JSON. */
export function readJsonIfPresent(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

/** Parses `--key value` pairs; a flag without a value is an error. */
export function parseFlags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument ${a}`);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
    out[a.slice(2)] = v;
    i += 1;
  }
  return out;
}
