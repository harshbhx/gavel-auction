import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  SANDBOX_SPEC_IDS,
  type GateId,
  type SandboxSpecId,
  type SandboxStatus,
  type SpecResult,
} from '../sandbox/harness.js';

// Nightly result summary (R-QA-029, R-QA-040, T-QA-058). Folds the per-spec result files into
// report/sandbox.json with one status per spec: pass, fail, inconclusive or skipped. A spec with
// no result file is `skipped` when the secrets were absent and `inconclusive` when they were
// present, because then the spec should have run and left a file.

export interface SandboxReportRow {
  spec: SandboxSpecId;
  gate: GateId;
  status: SandboxStatus;
  observed: string;
  finishedAt: string | null;
}

export interface SandboxReport {
  generatedAt: string;
  sha: string;
  secretsPresent: boolean;
  /** `fail` when any spec failed, else `inconclusive` when any was, else `pass`; `skipped` when nothing ran. */
  overall: SandboxStatus;
  counts: Record<SandboxStatus, number>;
  specs: SandboxReportRow[];
}

const STATUSES: readonly SandboxStatus[] = ['pass', 'fail', 'inconclusive', 'skipped'];

export interface ReportInput {
  generatedAt: string;
  sha: string;
  secretsPresent: boolean;
  results: readonly SpecResult[];
}

const DEFAULT_GATE: Record<SandboxSpecId, GateId> = {
  R1: 'G1',
  R2: 'G2',
  R3: 'G3',
  R4: 'G4',
  R5: 'G1',
  R6: 'G1',
  R7: 'G1',
  R8: 'G1',
  R10: 'G1',
  G5: 'none',
};

export function overallStatus(counts: Record<SandboxStatus, number>): SandboxStatus {
  if (counts.fail > 0) return 'fail';
  if (counts.inconclusive > 0) return 'inconclusive';
  if (counts.pass > 0) return 'pass';
  return 'skipped';
}

export function buildSandboxReport(input: ReportInput): SandboxReport {
  const byId = new Map(input.results.map((r) => [r.spec, r]));
  const specs: SandboxReportRow[] = SANDBOX_SPEC_IDS.map((spec) => {
    const r = byId.get(spec);
    if (r !== undefined) {
      return {
        spec,
        gate: r.gate,
        status: r.status,
        observed: r.observed,
        finishedAt: r.finishedAt,
      };
    }
    return input.secretsPresent
      ? {
          spec,
          gate: DEFAULT_GATE[spec],
          // With the secrets present every spec must write a result. A missing file means the
          // spec threw before finish() or never loaded, so it is a failure, not a transient.
          status: 'fail',
          observed: 'no result was written: the spec threw before finish() or did not load',
          finishedAt: null,
        }
      : {
          spec,
          gate: DEFAULT_GATE[spec],
          status: 'skipped',
          observed: 'secrets absent',
          finishedAt: null,
        };
  });
  const counts: Record<SandboxStatus, number> = { pass: 0, fail: 0, inconclusive: 0, skipped: 0 };
  for (const row of specs) counts[row.status] += 1;
  return {
    generatedAt: input.generatedAt,
    sha: input.sha,
    secretsPresent: input.secretsPresent,
    overall: overallStatus(counts),
    counts,
    specs,
  };
}

function isResult(v: unknown): v is SpecResult {
  if (v === null || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o['spec'] === 'string' &&
    (SANDBOX_SPEC_IDS as readonly string[]).includes(o['spec']) &&
    typeof o['status'] === 'string' &&
    (STATUSES as readonly string[]).includes(o['status']) &&
    typeof o['observed'] === 'string'
  );
}

/** Reads every well-formed result file of a directory; a missing directory gives none. */
export function readResults(dir: string): SpecResult[] {
  if (!existsSync(dir)) return [];
  const out: SpecResult[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    try {
      const v: unknown = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      if (isResult(v)) out.push(v);
    } catch {
      // A damaged file counts as no result.
    }
  }
  return out;
}

export function writeSandboxReport(path: string, report: SandboxReport): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
}

/** Markdown for the job summary: one line per spec, no secret and no id. */
export function renderSummary(report: SandboxReport): string {
  const lines = [
    `## Sandbox nightly: ${report.overall}`,
    '',
    '| spec | gate | status | observed |',
    '| ---- | ---- | ------ | -------- |',
    ...report.specs.map((r) => `| ${r.spec} | ${r.gate} | ${r.status} | ${r.observed} |`),
  ];
  return `${lines.join('\n')}\n`;
}
