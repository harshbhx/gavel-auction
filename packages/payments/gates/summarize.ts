import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { lintJsonl } from './evidence.js';

export type Decision = 'PASS' | 'PASS-WITH-FALLBACK' | 'FAIL';

export interface GateRow {
  id: string;
  expected: string;
  actual: string;
  verdict: string;
}

export interface GateEntry {
  gate: string;
  title: string;
  runId: string;
  operator: string;
  /** YYYY-MM-DD */
  date: string;
  scriptSha: string;
  /** Buyer kinds only, never credentials, for example "wallet (buyer-1@example.test)". */
  buyers: string[];
  rows: GateRow[];
  evidencePath: string;
  evidenceSha256: string;
  decision: Decision;
  fallback: string;
  flippedTags: string[];
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Renders one docs/GATES.md entry in the SPEC 7.2 template. */
export function formatEntry(e: GateEntry): string {
  const lines = [
    `## ${e.gate} ${e.title}  (run ${e.runId})`,
    `Operator: ${e.operator}   Date: ${e.date}   Env: sandbox   Script: ${e.scriptSha}`,
    `Buyers: ${e.buyers.join(', ')}         [no passwords]`,
    '| id | expected | actual | verdict |',
    '|----|----------|--------|---------|',
    ...e.rows.map((r) => `| ${r.id} | ${r.expected} | ${r.actual} | ${r.verdict} |`),
    `Evidence: ${e.evidencePath} (sha256 ${e.evidenceSha256})`,
    `Decision: ${e.decision}`,
    `Fallback adopted: ${e.fallback === '' ? 'none' : e.fallback}`,
    `Spec tags flipped: ${e.flippedTags.length === 0 ? 'none' : e.flippedTags.join(', ')}`,
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * Hashes the evidence file, refuses it when the lint finds problems, and
 * returns the entry with the hash filled in.
 */
export function withEvidenceHash(
  e: Omit<GateEntry, 'evidenceSha256'>,
  evidenceText: string,
): GateEntry {
  const problems = lintJsonl(evidenceText);
  if (problems.length > 0) {
    throw new Error(`evidence file failed lint at line ${problems[0]?.line ?? 0}`);
  }
  return { ...e, evidenceSha256: sha256Hex(evidenceText) };
}

/** Appends the entry to the gates document, separated by a blank line. */
export function appendEntry(gatesMdPath: string, e: GateEntry): void {
  const current = readFileSync(gatesMdPath, 'utf8');
  const sep = current.endsWith('\n\n') ? '' : current.endsWith('\n') ? '\n' : '\n\n';
  appendFileSync(gatesMdPath, `${sep}${formatEntry(e)}`);
}
