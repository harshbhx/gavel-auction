// Public docs must read as design documents, not as process notes.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const files = execFileSync('git', ['ls-files', 'docs', 'reference', 'README.md'], {
  cwd: root,
  encoding: 'utf8',
})
  .split('\n')
  .filter((f) => /\.(md|py)$/.test(f));
const PATTERNS = [
  /what i need from you/i,
  /needs-harsh/i,
  /\bHarsh\b/,
  /\bDhairya\b/,
  /until then i build/i,
  /red-?team/i,
  /outside (ai|evaluation)/i,
];

// Planning notes that must not appear anywhere in tracked docs.
const PLANNING_PATTERNS = [
  /private (github )?repo(sitory)?/i,
  /go-ahead before implementation/i,
  /^#{1,6} .*(nine-day|day-by-day) schedule/im,
  /^#{1,6} D[1-9]\b/m,
  /\bD[1-9] (Mon|Tue|Wed|Thu|Fri|Sat|Sun) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/,
  /\bkill the project\b|\bkill and pick\b/i,
];
// Stricter rules for the top-level overview documents.
const OVERVIEW = ['README.md', 'docs/PLAN.md', 'docs/specs/MASTER-PLAN.md'];
const OVERVIEW_PATTERNS = [
  /\bproject owner\b/i,
  /\bwaves?\b/i,
  /\bD[1-9]\b/,
  /\bschedule\b/i,
  /\bdeadline\b.*\b20\d\d-\d\d-\d\d\b/i,
  /\bfreeze\b/i,
  /\brole assignment\b/i,
];

describe('public docs', () => {
  it('contain no schedules, role assignments or internal prerequisites', () => {
    const hits = [];
    for (const f of files) {
      const text = readFileSync(join(root, f), 'utf8');
      for (const re of PLANNING_PATTERNS) if (re.test(text)) hits.push(`${f}: ${re}`);
    }
    for (const f of OVERVIEW) {
      const text = readFileSync(join(root, f), 'utf8');
      for (const re of OVERVIEW_PATTERNS) if (re.test(text)) hits.push(`${f}: ${re}`);
    }
    assert.deepEqual(hits, []);
  });

  it('contain no personal names or hand-off notes', () => {
    const hits = [];
    for (const f of files) {
      const text = readFileSync(join(root, f), 'utf8');
      for (const re of PATTERNS) if (re.test(text)) hits.push(`${f}: ${re}`);
    }
    assert.deepEqual(hits, []);
  });
});
