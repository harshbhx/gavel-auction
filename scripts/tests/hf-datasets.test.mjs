import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { aggregate } from '../hf/fetch-assurance.mjs';
import { main as build } from '../hf/build-datasets.mjs';
import { check } from '../hf/check-evidence-coverage.mjs';
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
});
