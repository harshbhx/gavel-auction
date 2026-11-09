import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildSandboxReport,
  overallStatus,
  readResults,
  renderSummary,
} from '../src/report/sandbox';
import type { SpecResult } from '../src/sandbox/harness';

const at = '2026-11-05T20:30:00Z';
const result = (spec: SpecResult['spec'], status: SpecResult['status']): SpecResult => ({
  spec,
  gate: 'G1',
  status,
  observed: `${spec} ${status}`,
  facts: {},
  finishedAt: at,
});
const base = { generatedAt: at, sha: 'abc123' };

describe('nightly sandbox report (T-QA-058)', () => {
  it('fails every spec when the secrets are present and nothing wrote a result', () => {
    const r = buildSandboxReport({ ...base, secretsPresent: true, results: [] });
    expect(r.specs.every((s) => s.status === 'fail')).toBe(true);
    expect(r.overall).toBe('fail');
  });

  it('marks every spec skipped when the secrets are absent', () => {
    const r = buildSandboxReport({ ...base, secretsPresent: false, results: [] });
    expect(r.specs).toHaveLength(11);
    expect(r.specs.every((s) => s.status === 'skipped')).toBe(true);
    expect(r.overall).toBe('skipped');
    expect(r.counts).toEqual({ pass: 0, fail: 0, inconclusive: 0, skipped: 11 });
  });

  it('records pass, fail, inconclusive and skipped side by side', () => {
    const r = buildSandboxReport({
      ...base,
      secretsPresent: true,
      results: [result('R1', 'pass'), result('R2', 'fail'), result('R3', 'inconclusive')],
    });
    expect(r.specs.find((s) => s.spec === 'R1')?.status).toBe('pass');
    expect(r.specs.find((s) => s.spec === 'R2')?.status).toBe('fail');
    expect(r.specs.find((s) => s.spec === 'R3')?.status).toBe('inconclusive');
    // With secrets present a spec that left no file crashed or never loaded: fail, never green.
    expect(r.specs.find((s) => s.spec === 'R8')?.status).toBe('fail');
    expect(r.overall).toBe('fail');
    expect(r.overall).toBe('fail');
  });

  it('ranks the overall status', () => {
    expect(overallStatus({ pass: 2, fail: 0, inconclusive: 1, skipped: 0 })).toBe('inconclusive');
    expect(overallStatus({ pass: 2, fail: 0, inconclusive: 0, skipped: 3 })).toBe('pass');
    expect(overallStatus({ pass: 0, fail: 1, inconclusive: 1, skipped: 0 })).toBe('fail');
  });

  it('reads result files and ignores damaged ones', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sbx-report-'));
    writeFileSync(join(dir, 'R1.json'), JSON.stringify(result('R1', 'pass')));
    writeFileSync(join(dir, 'R2.json'), '{not json');
    writeFileSync(
      join(dir, 'R3.json'),
      JSON.stringify({ spec: 'R99', status: 'pass', observed: '' }),
    );
    expect(readResults(dir).map((r) => r.spec)).toEqual(['R1']);
    expect(readResults(join(dir, 'missing'))).toEqual([]);
  });

  it('renders a table without ids or secrets', () => {
    const text = renderSummary(
      buildSandboxReport({ ...base, secretsPresent: true, results: [result('R1', 'pass')] }),
    );
    expect(text).toContain('| R1 | G1 | pass | R1 pass |');
    expect(text.startsWith('## Sandbox nightly: ')).toBe(true);
  });
});
