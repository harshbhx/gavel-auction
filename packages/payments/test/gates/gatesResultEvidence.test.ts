import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { gatesResultProblems } from '../../gates/verifyGatesResult.js';
import { gatesResult } from '../../src/gatesResult.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const md = readFileSync(join(root, 'docs/GATES.md'), 'utf8');

describe('gates-result flags are tied to evidence (R4-G09)', () => {
  it('the shipped flags are backed by closed GATES.md entries and matching evidence hashes', () => {
    expect(gatesResultProblems(gatesResult, md, root)).toEqual([]);
  });

  it('rejects g2_card_authorize true while G2 has not run', () => {
    const problems = gatesResultProblems({ ...gatesResult, g2_card_authorize: true }, md, root);
    expect(problems.join('\n')).toContain('G2: Status is not PASS');
  });

  it('rejects a G1 mode that differs from the recorded decision', () => {
    const problems = gatesResultProblems({ ...gatesResult, g1_remainder_mode: 'B' }, md, root);
    expect(problems.join('\n')).toContain('differs from the flag');
  });

  it('rejects an edited evidence file', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'gates-ev-'));
    try {
      for (const g of ['G1', 'G4']) mkdirSync(join(tmp, 'docs/evidence', g), { recursive: true });
      for (const m of md.matchAll(/^Evidence: (\S+) \(sha256/gm)) {
        const rel = m[1] as string;
        writeFileSync(join(tmp, rel), `${readFileSync(join(root, rel), 'utf8')}{"edited":1}\n`);
      }
      const problems = gatesResultProblems(gatesResult, md, tmp);
      expect(problems.join('\n')).toContain('hash differs');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('rejects a flag with no evidence file at all', () => {
    const problems = gatesResultProblems(gatesResult, md, join(root, 'docs/none'));
    expect(problems.join('\n')).toContain('is missing');
  });
});
