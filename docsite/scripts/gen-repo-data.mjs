#!/usr/bin/env node
// Reads the committed repo evidence and writes lib/generated/repo-data.json.
// The docs site shows these numbers, so a page can never differ from the repo:
//   docs/GATES.md                       gate status, speech accuracy table, latency table
//   docs/evidence/SIM/SIM-MULTIDAY.md   the simulated multi-day scenarios and the 30 day totals
// The build fails when a file or a table cannot be read, instead of showing stale numbers.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const outFile = join(here, '..', 'lib', 'generated', 'repo-data.json');

function read(rel) {
  try {
    return readFileSync(join(repoRoot, rel), 'utf8');
  } catch (e) {
    throw new Error(`gen-repo-data: cannot read ${rel}: ${e.message}`);
  }
}

function cells(line) {
  return line
    .split('|')
    .slice(1, -1)
    .map((c) => c.trim());
}

function tableRows(lines, startIdx) {
  const rows = [];
  for (let i = startIdx; i < lines.length; i += 1) {
    if (!lines[i].startsWith('|')) break;
    rows.push(cells(lines[i]));
  }
  return rows.filter((r) => !r.every((c) => /^-+$/.test(c)));
}

// ---- GATES.md ----
const gates = read('docs/GATES.md');
const gateLines = gates.split('\n');
const gateStatus = [];
for (let i = 0; i < gateLines.length; i += 1) {
  const m = /^## (G[0-5]): (.+)$/.exec(gateLines[i]);
  if (!m) continue;
  let status = '';
  let run = '';
  for (let j = i + 1; j < Math.min(i + 8, gateLines.length); j += 1) {
    if (gateLines[j].startsWith('Status:')) status = gateLines[j].slice(7).trim();
    if (gateLines[j].startsWith('Run date / by:')) run = gateLines[j].slice(14).trim();
  }
  gateStatus.push({ id: m[1], title: m[2], status, run });
}
if (gateStatus.length !== 6) throw new Error(`gen-repo-data: expected 6 gates, found ${gateStatus.length}`);

const speech = [];
for (const line of gateLines) {
  const c = line.startsWith('|') ? cells(line) : [];
  if (c.length === 7 && (c[0].startsWith('eSpeak') || c[0].startsWith('human-like'))) {
    speech.push({
      clipSet: c[0],
      provider: c[1],
      n: Number(c[2]),
      exact: c[3],
      wrongAccept: c[4],
      confirm: c[5],
      missedBid: c[6],
    });
  }
}
if (speech.length !== 4) throw new Error(`gen-repo-data: expected 4 speech rows, found ${speech.length}`);

const latency = [];
const latIdx = gateLines.findIndex((l) => l.startsWith('| Call') && l.includes('p50'));
if (latIdx < 0) throw new Error('gen-repo-data: latency table not found in GATES.md');
for (const c of tableRows(gateLines, latIdx).slice(1)) {
  latency.push({ call: c[0], p50: Number(c[1]), p95: Number(c[2]), max: Number(c[3]) });
}
if (latency.length !== 4) throw new Error(`gen-repo-data: expected 4 latency rows, found ${latency.length}`);

// ---- SIM-MULTIDAY.md ----
const sim = read('docs/evidence/SIM/SIM-MULTIDAY.md');
const simLines = sim.split('\n');
const scnIdx = simLines.findIndex((l) => l.startsWith('| Scenario'));
if (scnIdx < 0) throw new Error('gen-repo-data: scenario table not found in SIM-MULTIDAY.md');
const scenarios = tableRows(simLines, scnIdx)
  .slice(1)
  .map((c) => ({ id: c[0], title: c[1], checks: c[2], result: c[3] }));
if (scenarios.length < 8) throw new Error('gen-repo-data: expected 8 scenarios');

const s8 = simLines.findIndex((l) => l.startsWith('## S8'));
const measIdx = simLines.findIndex((l, i) => i > s8 && l.startsWith('| Measure'));
if (s8 < 0 || measIdx < 0) throw new Error('gen-repo-data: S8 measures not found');
const measures = {};
for (const c of tableRows(simLines, measIdx).slice(1)) measures[c[0]] = c[1];
const m = (k) => {
  if (!(k in measures)) throw new Error(`gen-repo-data: S8 measure "${k}" missing`);
  return measures[k];
};
const [settled, inReview] = m('lots settled / in review').split('/').map((s) => Number(s.trim()));
const ledgerCheck = simLines.find((l) => l.includes('ledger balances to the cent') && l.includes('held '));
const ledger = /held (\d+) captured (\d+) released (\d+) open (\d+)/.exec(ledgerCheck ?? '');
if (!ledger) throw new Error('gen-repo-data: S8 ledger line not found');

const data = {
  gates: gateStatus,
  speech,
  latency,
  sim: {
    scenarios,
    s8: {
      lotsSettled: settled,
      lotsInReview: inReview,
      holds: Number(m('holds')),
      reauthorizeCalls: Number(m('reauthorize calls')),
      crashesSurvived: Number(m('process crashes survived')),
      faultsArmed: Number(m('PayPal faults armed')),
      fallbackLots: Number(m('lots that used the runner-up fallback')),
      stormLots: Number(m('429 storm lots (injected)')),
      stormSettled: Number(m('429 storm lots settled after a restart')),
      heldCents: Number(ledger[1]),
      capturedCents: Number(ledger[2]),
      releasedCents: Number(ledger[3]),
      openCents: Number(ledger[4]),
      seed: m('seed'),
    },
  },
};

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, `${JSON.stringify(data, null, 2)}\n`);
console.log(`gen-repo-data: wrote ${outFile} (${gateStatus.length} gates, ${scenarios.length} scenarios)`);

// The OpenAPI document is served from the docs site at /openapi.yaml. The repo keeps one copy
// (openapi/gavel.yaml); this copies it into public/ for every build, so the two cannot differ.
read('openapi/gavel.yaml');
copyFileSync(join(repoRoot, 'openapi', 'gavel.yaml'), join(here, '..', 'public', 'openapi.yaml'));
console.log('gen-repo-data: copied openapi/gavel.yaml to public/openapi.yaml');
