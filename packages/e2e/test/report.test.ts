import { describe, expect, it } from 'vitest';
import {
  buildSummary,
  loadTemplate,
  renderHtml,
  validateSummary,
  type ReportInputs,
} from '../src/report/build';

const full: ReportInputs = {
  sha: 'abc1234',
  builtAt: '2026-11-09T18:00:00Z',
  layers: {
    unit: { total: 612, passed: 612 },
    property: { total: 41, passed: 41, cases: 8200 },
    contract: { total: 63, passed: 63 },
    scenario: { total: 44, passed: 44 },
    e2e: { total: 52, passed: 52, flaky: 0 },
    sandbox: { total: 8, passed: 8, lastRun: '2026-11-09T20:30:00Z' },
    load: { p95AckMs: 118, lostBids: 0, scripts: 4 },
  },
  coverage: { engine: { lines: 97.1, branches: 92.4 } },
  scenarioMatrix: [
    { id: 'S03', inproc: 'pass', chromium: 'pass', firefox: 'pass', webkit: 'pass' },
  ],
  invariants: { I1: 214 },
  mutation: { engine: 84 },
};

describe('report builder (T-QA-086)', () => {
  it('builds a summary valid against the schema and renders all layer counts', () => {
    const summary = buildSummary(full);
    expect(validateSummary(summary)).toEqual([]);
    expect(summary.warnings).toEqual([]);
    const html = renderHtml(summary, loadTemplate());
    expect(html).toContain('abc1234');
    expect(html).toContain('653');
    expect(html).toContain('L5 real sandbox');
    expect(html).not.toContain('{{');
  });

  it('renders n/a for a missing layer instead of crashing', () => {
    const summary = buildSummary({ sha: 'x', builtAt: 'now' });
    expect(validateSummary(summary)).toEqual([]);
    const html = renderHtml(summary, loadTemplate());
    expect(html).toContain('n/a');
  });

  it('warns when counts are under the targets', () => {
    const summary = buildSummary({
      sha: 'x',
      builtAt: 'now',
      layers: { unit: { total: 10, passed: 10 }, e2e: { total: 2, passed: 2 } },
    });
    expect(summary.warnings.some((w) => w.includes('L1'))).toBe(true);
    expect(summary.warnings.some((w) => w.includes('L4'))).toBe(true);
    expect(summary.warnings.some((w) => w.includes('L2'))).toBe(false);
  });

  it('rejects a summary that breaks the schema', () => {
    const bad = { ...buildSummary(full), sha: 5 };
    expect(validateSummary(bad).length).toBeGreaterThan(0);
  });

  it('escapes markup in values', () => {
    const summary = buildSummary({ ...full, sha: '<b>' });
    expect(renderHtml(summary, loadTemplate())).toContain('&lt;b&gt;');
  });
});
