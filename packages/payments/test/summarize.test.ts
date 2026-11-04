import { describe, expect, it } from 'vitest';
import { toJsonlLine, type EvidenceRecord } from '../gates/evidence.js';
import { formatEntry, sha256Hex, withEvidenceHash } from '../gates/summarize.js';

const base: EvidenceRecord = {
  gate: 'G1',
  runId: 'G1-20261104T101500Z-wallet',
  step: 'G1.4 capture 350 final',
  tsMs: 1762251300000,
  env: 'sandbox',
  scriptVersion: 'abc1234',
};

describe('summarize', () => {
  it('formats the SPEC 7.2 entry with the evidence hash', () => {
    const text = `${toJsonlLine(base)}\n`;
    const entry = withEvidenceHash(
      {
        gate: 'G1',
        title: 'partial capture and remainder',
        runId: 'G1-20261104T101500Z',
        operator: 'op',
        date: '2026-11-04',
        scriptSha: 'abc1234',
        buyers: ['wallet'],
        rows: [
          { id: 'G1.5', expected: 'open or released', actual: 'released', verdict: 'observed' },
        ],
        evidencePath: 'docs/evidence/G1/G1-20261104T101500Z.jsonl',
        decision: 'PASS',
        fallback: '',
        flippedTags: [],
      },
      text,
    );
    const out = formatEntry(entry);
    expect(entry.evidenceSha256).toBe(sha256Hex(text));
    expect(out).toContain('## G1 partial capture and remainder  (run G1-20261104T101500Z)');
    expect(out).toContain('| G1.5 | open or released | released | observed |');
    expect(out).toContain(`(sha256 ${sha256Hex(text)})`);
    expect(out).toContain('Fallback adopted: none');
    expect(out).toContain('\nStatus: PASS\n');
    expect(formatEntry({ ...entry, decision: 'FAIL' })).toContain('\nStatus: FAIL\n');
    expect(() => withEvidenceHash({ ...entry }, 'not json\n')).toThrow(/lint/);
  });
});
