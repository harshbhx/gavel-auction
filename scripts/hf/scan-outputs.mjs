#!/usr/bin/env node
// Privacy and secret scan over every text file of the built datasets. Exit 1 on any hit.
// Usage: node scripts/hf/scan-outputs.mjs OUT_DIR
// Hits are reported as file, line and rule name only; the matched text is never printed.
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RULES = [
  ['email address', /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/],
  ['huggingface token', /\bhf_[A-Za-z0-9]{20,}/],
  ['github token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/],
  ['api key (sk-)', /\bsk-[A-Za-z0-9_-]{20,}/],
  ['aws access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\./],
  ['bearer or basic credential', /\b(?:Bearer|Basic)\s+[A-Za-z0-9+/=._-]{20,}/],
  ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  [
    'secret-looking assignment',
    /\b(?:client_secret|api_key|apikey|access_token|password|passwd|secret)["']?\s*[:=]\s*["']?(?!\[REDACTED\]|null|false|true)[A-Za-z0-9_./+-]{12,}/i,
  ],
  ['ipv4 address', /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/],
  [
    'payment-object-like id',
    /(?<![A-Za-z0-9_-])(?=[0-9A-Z]*\d)(?=[0-9A-Z]*[A-Z])[0-9A-Z]{17}(?![A-Za-z0-9_-])/,
  ],
  ['payment-object-like id (prefixed)', /\b(?:PAYID|PAY|ORDER|CAPTURE|AUTH)-[0-9A-Z]{10,}\b/],
];

const TEXT = new Set(['.md', '.jsonl', '.csv', '.json', '.py', '.txt', '.yaml', '.yml']);

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

export function scanText(text) {
  const hits = [];
  text.split('\n').forEach((line, i) => {
    for (const [name, re] of RULES) if (re.test(line)) hits.push({ line: i + 1, rule: name });
  });
  return hits;
}

export function main(outArg) {
  const out = resolve(outArg);
  let files = 0;
  const problems = [];
  for (const p of walk(out).sort()) {
    if (!TEXT.has(extname(p))) continue;
    files += 1;
    for (const h of scanText(readFileSync(p, 'utf8'))) {
      problems.push(`${relative(out, p)}:${h.line} ${h.rule}`);
    }
  }
  if (problems.length > 0) {
    process.stderr.write(
      `privacy scan FAILED, ${problems.length} hit(s) (text withheld):\n${problems.join('\n')}\n`,
    );
    return 1;
  }
  process.stdout.write(
    `privacy scan passed: ${files} text files, ${RULES.length} rules, no hits\n`,
  );
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = process.argv.length === 3 ? main(process.argv[2]) : 2;
}
