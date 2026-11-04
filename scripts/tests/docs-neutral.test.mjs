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

describe('public docs', () => {
  it('contain no personal names or hand-off notes', () => {
    const hits = [];
    for (const f of files) {
      const text = readFileSync(join(root, f), 'utf8');
      for (const re of PATTERNS) if (re.test(text)) hits.push(`${f}: ${re}`);
    }
    assert.deepEqual(hits, []);
  });
});
