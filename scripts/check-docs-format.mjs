#!/usr/bin/env node
// Lints docs/DECISIONS.md and docs/GATES.md against the formats in SPEC-quality 4.7 and 4.8.
// Usage: node scripts/check-docs-format.mjs [--self-test] [decisionsPath gatesPath]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DECISION_FIELDS = [
  'Date',
  'Status',
  'Owner',
  'Context',
  'Decision',
  'Alternatives',
  'Consequences',
  'Evidence',
];
const GATE_FIELDS = [
  'Status',
  'Run date / by',
  'Question',
  'Setup',
  'Requests',
  'Observed',
  'Verdict',
  'Decision',
  'Fallback if FAIL',
  'Links',
];
const GATE_STATUSES = ['NOT RUN', 'PASS', 'PARTIAL', 'FAIL'];

function splitBlocks(text, headingRe) {
  const lines = text.split('\n');
  const blocks = [];
  let cur = null;
  for (const line of lines) {
    const m = headingRe.exec(line);
    if (m) {
      cur = { id: m[1], heading: line, body: [] };
      blocks.push(cur);
    } else if (cur) {
      cur.body.push(line);
    }
  }
  return blocks;
}

function fieldValue(body, name) {
  const re = new RegExp(`^${name.replace(/[/]/g, '\\/')}:[ \\t]*(.*)$`);
  for (let i = 0; i < body.length; i += 1) {
    const m = re.exec(body[i]);
    if (m) {
      const parts = [m[1]];
      for (let j = i + 1; j < body.length; j += 1) {
        if (/^[A-Z][A-Za-z /]*:/.test(body[j])) break;
        parts.push(body[j]);
      }
      return parts.join('\n').trim();
    }
  }
  return null;
}

export function lintDecisions(text) {
  const errors = [];
  if (!/^# Decisions/m.test(text)) errors.push('DECISIONS.md: missing "# Decisions" title');
  const blocks = splitBlocks(text, /^## (D-\d{4}): .+$/);
  if (blocks.length === 0) errors.push('DECISIONS.md: no decision entries');
  let prev = 0;
  for (const b of blocks) {
    const n = Number(b.id.slice(2));
    if (n <= prev) errors.push(`${b.id}: ids must be unique and ascending`);
    prev = n;
    for (const f of DECISION_FIELDS) {
      const v = fieldValue(b.body, f);
      if (v === null) errors.push(`${b.id}: missing "${f}:" line`);
      else if (f === 'Date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) errors.push(`${b.id}: bad Date`);
      else if (f === 'Status' && !/^(accepted|superseded by D-\d{4})$/.test(v)) {
        errors.push(`${b.id}: Status must be "accepted" or "superseded by D-NNNN"`);
      }
    }
  }
  return errors;
}

export function lintGates(text) {
  const errors = [];
  if (!/^# Gates/m.test(text)) errors.push('GATES.md: missing "# Gates" title');
  const blocks = splitBlocks(text, /^## (G\d): .+$/);
  const ids = blocks.map((b) => b.id);
  for (const want of ['G1', 'G2', 'G3', 'G4', 'G5']) {
    if (!ids.includes(want)) errors.push(`GATES.md: missing block ${want}`);
  }
  for (const b of blocks) {
    for (const f of GATE_FIELDS) {
      if (fieldValue(b.body, f) === null) errors.push(`${b.id}: missing "${f}:" line`);
    }
    const status = fieldValue(b.body, 'Status');
    if (status !== null && !GATE_STATUSES.includes(status)) {
      errors.push(`${b.id}: Status must be one of ${GATE_STATUSES.join(' | ')}`);
    }
    if (status === 'PASS' || status === 'FAIL' || status === 'PARTIAL') {
      const ev = fieldValue(b.body, 'Evidence');
      if (!ev) errors.push(`${b.id}: ${status} requires a non-empty "Evidence:" line`);
    }
    if (status === 'PASS' || status === 'FAIL') {
      if (!fieldValue(b.body, 'Decision')) {
        errors.push(`${b.id}: a closed gate (${status}) needs a recorded Decision`);
      }
    }
  }
  return errors;
}

function selfTest() {
  const dec = (extra = '') =>
    `# Decisions\n\n## D-0001: x\nDate: 2026-11-04\n${extra}Owner: quality\nContext: a\nDecision: b\nAlternatives: c\nConsequences: d\nEvidence: e\n`;
  const gate = (status, evidence, decision = 'use it') =>
    ['G1', 'G2', 'G3', 'G4', 'G5']
      .map(
        (g) =>
          `## ${g}: t\nStatus: ${g === 'G1' ? status : 'NOT RUN'}\nRun date / by: n/a\nQuestion: q\nSetup: s\nRequests: r\nObserved: o\nVerdict: v\nDecision: ${g === 'G1' ? decision : 'n/a'}\nFallback if FAIL: f\nLinks: l\n${g === 'G1' ? evidence : ''}`,
      )
      .join('\n');
  const cases = [
    ['decision ok', lintDecisions(dec('Status: accepted\n')).length === 0],
    ['decision missing Status', lintDecisions(dec()).length > 0],
    ['gate NOT RUN ok', lintGates(`# Gates\n\n${gate('NOT RUN', '')}`).length === 0],
    [
      'gate PASS with evidence ok',
      lintGates(`# Gates\n\n${gate('PASS', 'Evidence: run 1\n')}`).length === 0,
    ],
    ['gate PASS without evidence fails', lintGates(`# Gates\n\n${gate('PASS', '')}`).length > 0],
    ['gate bad status fails', lintGates(`# Gates\n\n${gate('DONE', '')}`).length > 0],
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
  const [dPath = 'docs/DECISIONS.md', gPath = 'docs/GATES.md'] = args;
  const errors = [
    ...lintDecisions(readFileSync(dPath, 'utf8')),
    ...lintGates(readFileSync(gPath, 'utf8')),
  ];
  for (const e of errors) console.error(e);
  if (errors.length === 0) console.log('docs format ok');
  return errors.length === 0 ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main());
}
