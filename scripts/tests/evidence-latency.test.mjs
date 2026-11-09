import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MIN_SAMPLES,
  TARGETS,
  buildLatencyEvidence,
  conservativeP95,
  latencyVerdictLine,
  renderLatencyMarkdown,
} from '../evidence/latency-report.mjs';
import { summarize } from '../evidence/lib.mjs';

const stat = (xs, failures = 0) => ({ ...summarize(xs), failures });
const series = (n, base) => Array.from({ length: n }, (_, i) => base + i);

function good(n = 50, capBase = 2000, setBase = 5000) {
  const ops = {};
  for (const op of ['order', 'authorize', 'capture', 'void']) ops[op] = stat(series(n, 500));
  return {
    calls: { cycles: n, completed: n, ops, count429: 0 },
    settlement: {
      settlements: n,
      holdsPerSettlement: 6,
      authorizationsUsed: n * 6,
      mismatches: 0,
      errors: 0,
      hammerToCaptured: stat(series(n, capBase)),
      hammerToSettled: stat(series(n, setBase)),
    },
  };
}

describe('latency evidence', () => {
  it('records a run that meets the targets', () => {
    const ev = buildLatencyEvidence(good());
    assert.equal(ev.verdict, 'RECORDED');
    assert.equal(ev.settlement.hammerToCaptured.status, 'MET');
    assert.equal(ev.settlement.hammerToSettled.status, 'MET');
    assert.equal(ev.calls.ops.void.status, 'MET');
  });

  it('reports MISSED against the unchanged targets when the numbers are worse', () => {
    const ev = buildLatencyEvidence(good(50, 2600, 6100));
    assert.equal(ev.verdict, 'RECORDED');
    assert.equal(ev.settlement.hammerToCaptured.status, 'MISSED');
    assert.equal(ev.settlement.hammerToSettled.status, 'MISSED');
    assert.equal(ev.targets.capturedP95Ms, 2500);
    assert.equal(ev.targets.settledP95Ms, 6000);
    assert.equal(ev.settlement.hammerToCaptured.targetP95Ms, TARGETS.capturedP95Ms);
  });

  it('judges the p95, not the median', () => {
    const base = good();
    base.settlement.hammerToCaptured = stat([...series(47, 2000), 2600, 2700, 2800]);
    const ev = buildLatencyEvidence(base);
    assert.ok(ev.settlement.hammerToCaptured.p95 > 2500);
    assert.equal(ev.settlement.hammerToCaptured.status, 'MISSED');
  });

  it('is INCOMPLETE for a small sample, failures or a missing part', () => {
    const small = buildLatencyEvidence(good(MIN_SAMPLES - 1));
    assert.equal(small.verdict, 'INCOMPLETE');
    assert.ok(small.problems.some((p) => /below 40/.test(p)));

    const failing = good();
    failing.settlement.mismatches = 2;
    assert.equal(buildLatencyEvidence(failing).verdict, 'INCOMPLETE');

    const failedCall = good();
    failedCall.calls.ops.void = stat(series(50, 500), 3);
    assert.ok(buildLatencyEvidence(failedCall).problems.some((p) => /3 failed/.test(p)));

    assert.equal(buildLatencyEvidence({ settlement: good().settlement }).verdict, 'INCOMPLETE');
    assert.equal(buildLatencyEvidence({ calls: good().calls }).verdict, 'INCOMPLETE');
  });

  it('prints n next to every figure and a grep-able verdict line', () => {
    const ev = buildLatencyEvidence(good(50, 2600));
    const md = renderLatencyMarkdown(ev);
    assert.match(md, /hammer to CAPTURED \| 50 \|/);
    const line = latencyVerdictLine(ev);
    assert.match(line, /^LATENCY EVIDENCE VERDICT: RECORDED/);
    assert.match(line, /CAPTURED p95 .* vs 2500: MISSED, n=50/);
  });

  it('counts failures in the worst case and never reports MET with failures (issue 2324)', () => {
    // 50 attempts, 2 timed out: the 48th of 50 attempts is a success at most p99, 49th/50th fail.
    const ok = series(48, 2000);
    const c = conservativeP95({ ...summarize(ok), failures: 2 });
    assert.equal(c.attempts, 50);
    assert.equal(c.bound, true);
    assert.ok(c.value === null || c.value >= summarize(ok).p95);
    // 3 failures of 10 attempts: the 95th-percentile rank (10) is a failed attempt.
    assert.equal(conservativeP95({ ...summarize(series(7, 100)), failures: 3 }).value, null);
    // No failures: the conservative figure is the reported p95.
    const clean = summarize(series(50, 100));
    assert.equal(conservativeP95({ ...clean, failures: 0 }).value, clean.p95);

    const base = good();
    base.settlement.hammerToSettled = { ...summarize(series(48, 2000)), failures: 2 };
    const ev = buildLatencyEvidence(base);
    assert.equal(ev.settlement.hammerToSettled.status, 'UNPROVEN');
    assert.equal(ev.settlement.hammerToSettled.attempts, 50);
    assert.equal(ev.verdict, 'INCOMPLETE');
    assert.ok(ev.problems.some((p) => /2 of 50 attempts failed/.test(p)));
    assert.match(renderLatencyMarkdown(ev), /p95 all attempts ms/);
  });
});
