#!/usr/bin/env node
// Fails when a flag in packages/payments/src/gates-result.json is switched on without a closed
// entry in docs/GATES.md (R-PAY-037: a gate is closed only with a recorded Decision and an
// Evidence line). Flags may only be changed together with the recorded gate result.
// Usage: node scripts/check-gates-result.mjs [gatesResultPath gatesMdPath]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const KEYS = ['g1_remainder_mode', 'g2_card_authorize', 'g4_webhooks_verified'];

/** Reads each "## G<n>: ..." section of GATES.md into its Status, Decision and Evidence lines. */
export function parseGateSections(md) {
  const sections = {};
  let current;
  for (const line of md.split('\n')) {
    const head = /^## (G\d+)\b/.exec(line);
    if (head) {
      current = { status: '', decision: '', evidence: '' };
      sections[head[1]] = current;
      continue;
    }
    if (line.startsWith('## ')) {
      current = undefined;
      continue;
    }
    if (!current) continue;
    const field = /^(Status|Decision|Evidence):\s*(.*)$/.exec(line);
    if (field) current[field[1].toLowerCase()] = field[2].trim();
  }
  return sections;
}

function closed(section, wantedStatus) {
  if (!section) return 'has no entry in docs/GATES.md';
  if (section.status !== wantedStatus) return `has Status "${section.status}", not ${wantedStatus}`;
  if (section.decision === '' || section.decision.toLowerCase() === 'n/a') {
    return 'has no recorded Decision';
  }
  if (section.evidence === '' || section.evidence.toLowerCase() === 'n/a') {
    return 'has no Evidence line';
  }
  return undefined;
}

/** Returns a list of problem strings; empty when the flags agree with GATES.md. */
export function checkGatesResult(flags, md) {
  const problems = [];
  if (typeof flags !== 'object' || flags === null) return ['gates-result.json is not an object'];
  for (const k of Object.keys(flags)) {
    if (!KEYS.includes(k)) problems.push(`unknown flag ${k}`);
  }
  const sections = parseGateSections(md);
  const mode = flags.g1_remainder_mode;
  if (!['A', 'B', 'C', 'unknown'].includes(mode)) problems.push('g1_remainder_mode is invalid');
  else if (mode !== 'unknown') {
    // G1 may close as PASS or FAIL; either way the mode needs a recorded decision.
    const why = closed(sections.G1, sections.G1?.status === 'FAIL' ? 'FAIL' : 'PASS');
    if (why) problems.push(`g1_remainder_mode is ${mode} but G1 ${why}`);
  }
  for (const [flag, gate] of [
    ['g2_card_authorize', 'G2'],
    ['g4_webhooks_verified', 'G4'],
  ]) {
    if (typeof flags[flag] !== 'boolean') problems.push(`${flag} must be true or false`);
    else if (flags[flag]) {
      const why = closed(sections[gate], 'PASS');
      if (why) problems.push(`${flag} is true but ${gate} ${why}`);
    }
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [flagsPath, mdPath] = process.argv.slice(2);
  const flags = JSON.parse(
    readFileSync(flagsPath ?? join(root, 'packages/payments/src/gates-result.json'), 'utf8'),
  );
  const md = readFileSync(mdPath ?? join(root, 'docs/GATES.md'), 'utf8');
  const problems = checkGatesResult(flags, md);
  for (const p of problems) console.error(`check:gates-result: ${p}`);
  if (problems.length > 0) process.exit(1);
  console.log('check:gates-result ok');
}
