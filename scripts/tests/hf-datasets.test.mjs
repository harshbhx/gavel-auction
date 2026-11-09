import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { aggregate } from '../hf/fetch-assurance.mjs';
import { main as build } from '../hf/build-datasets.mjs';
import { check } from '../hf/check-evidence-coverage.mjs';
import { compare, snapshot } from '../hf/check-drift.mjs';
import { main as finalize } from '../hf/finalize.mjs';
import {
  evidenceGroup,
  gateStatus,
  loadLatencyRuns,
  latencyRows,
  parseDate,
  walkEvidence,
} from '../hf/evidence-index.mjs';
import { readFileSync } from 'node:fs';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const gatesText = readFileSync(join(ROOT, 'docs', 'GATES.md'), 'utf8');

describe('hf datasets', () => {
  it('assurance severity and area rows reconcile with an unlabelled row (issue 2328)', () => {
    const issue = (n, labels) => ({
      number: n,
      state: 'closed',
      created_at: '2026-11-01T00:00:00Z',
      closed_at: '2026-11-01T01:00:00Z',
      labels,
    });
    const rows = aggregate(
      [
        issue(1, ['red-team', 'severity:high', 'area:web']),
        issue(2, ['red-team', 'severity:low', 'area:web', 'area:server']),
        issue(3, ['red-team']),
        issue(4, ['audit-r1']),
      ],
      'o/r',
      '2026-11-09',
    );
    const sev = rows.filter((r) => r.dimension === 'severity');
    const rt = rows.find((r) => r.dimension === 'label' && r.key === 'red-team');
    assert.equal(sev.find((r) => r.key === 'unlabelled').found, 1);
    assert.equal(
      sev.reduce((a, r) => a + r.found, 0),
      rt.found,
    );
    const unlabelledArea = rows.find((r) => r.dimension === 'area' && r.key === 'unlabelled');
    assert.equal(unlabelledArea.found, 2);
  });

  it('derives the G3 status from docs/GATES.md instead of a frozen override (issue 2322)', () => {
    const base = {
      status: 'NOT RUN',
      runLine: 'IN PROGRESS, real probe, day 0 was 7 Nov 2026 03:06 UTC. More.',
    };
    assert.equal(gateStatus(base).status, 'IN PROGRESS');
    assert.equal(gateStatus({ status: 'PASS', runLine: '2026-11-12 by x' }).status, 'PASS');
    assert.equal(gateStatus({ status: 'FAIL', runLine: 'IN PROGRESS' }).status, 'FAIL');
    assert.equal(parseDate(base.runLine), '2026-11-07T03:06:00Z');
    assert.equal(evidenceGroup('docs/evidence/G3-early/x.json'), 'G3');
    assert.equal(evidenceGroup('docs/evidence/latency/x.json'), 'latency');
  });

  it('reads every committed latency run, failures included (issue 2321)', () => {
    const runs = loadLatencyRuns(ROOT, gatesText);
    assert.ok(runs.settlements.some((r) => r.id === '42563147792'));
    const { spanRows } = latencyRows(runs);
    const settled = spanRows.find(
      (r) => r.run_id === 42563147792 && r.span === 'hammer_to_settled',
    );
    assert.equal(settled.n, 49);
    assert.equal(settled.attempts, 50);
    assert.equal(settled.failures, 1);
    assert.equal(settled.met, false);
    assert.ok(settled.p95_all_attempts_ms >= settled.p95_ms);
  });

  it('the built datasets cover all evidence and carry no workers.dev link', () => {
    const out = mkdtempSync(join(tmpdir(), 'hf-'));
    try {
      const w = process.stdout.write;
      process.stdout.write = () => true;
      try {
        build(['--out', out, '--dataset', 'gavel-latency']);
        build(['--out', out, '--dataset', 'gavel-gates']);
      } finally {
        process.stdout.write = w;
      }
      assert.deepEqual(check(out), []);
      assert.ok(walkEvidence(ROOT).length > 50);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
  it('cards carry the source commit, the sandbox flags and only the custom-domain links', () => {
    const out = mkdtempSync(join(tmpdir(), 'hf-'));
    try {
      const w = process.stdout.write;
      process.stdout.write = () => true;
      try {
        build(['--out', out, '--dataset', 'gavel-latency']);
        build(['--out', out, '--dataset', 'gavel-gates']);
      } finally {
        process.stdout.write = w;
      }
      for (const name of ['gavel-latency', 'gavel-gates']) {
        const card = readFileSync(join(out, name, 'README.md'), 'utf8');
        assert.match(card, /^license: cc-by-4\.0$/m);
        assert.match(card, /^source_commit: \S+$/m);
        assert.match(card, /^source_commit_date: \S+$/m);
        assert.match(card, /^sandbox: true$/m);
        assert.match(card, /^production_data: false$/m);
        assert.ok(card.includes('https://gavel.dualmindlab.tech'));
        assert.ok(card.includes('https://docs.gavel.dualmindlab.tech'));
        assert.ok(
          card.includes('https://github.com/harshbhx/gavel-auction/tree/main/docs/evidence'),
        );
        assert.ok(!card.includes('workers.dev'));
      }
      const gates = readFileSync(join(out, 'gavel-gates', 'gates.jsonl'), 'utf8')
        .split('\n')
        .filter((l) => l !== '')
        .map((l) => JSON.parse(l));
      assert.deepEqual(
        gates.map((g) => g.gate),
        ['G0', 'G1', 'G2', 'G3', 'G4', 'G5'],
      );
      assert.ok(gates.every((g) => g.evidence_files !== ''));
      assert.equal(gates.find((g) => g.gate === 'G3').status, 'IN PROGRESS');
      assert.equal(gates.find((g) => g.gate === 'G5').status, 'PARTIAL');
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('the drift check passes on the committed lock and fails on a missing evidence file', () => {
    const out = mkdtempSync(join(tmpdir(), 'hf-'));
    try {
      const w = process.stdout.write;
      process.stdout.write = () => true;
      try {
        build(['--out', out, '--dataset', 'gavel-latency']);
        build(['--out', out, '--dataset', 'gavel-gates']);
        finalize(out);
      } finally {
        process.stdout.write = w;
      }
      const lock = JSON.parse(readFileSync(join(ROOT, 'hf', 'datasets.lock.json'), 'utf8'));
      const snap = snapshot(out);
      assert.deepEqual(compare(lock, snap), []);
      const dropped = { ...snap, evidence_files: snap.evidence_files.slice(1) };
      assert.ok(compare(lock, dropped).length > 0);
      const changed = structuredClone(snap);
      changed.evidence_files[0].sha256 = '0'.repeat(64);
      assert.ok(compare(lock, changed).some((p) => p.includes('changed')));
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
