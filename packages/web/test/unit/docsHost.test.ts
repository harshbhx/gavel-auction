import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOCS_URL } from '../../src/screens/landing/LandingSections';
import { NOT_FOUND_DOCS_URL } from '../../src/screens/states/NotFound';
import { en } from '../../src/copy/en';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('docs host (issue 2318)', () => {
  it('uses one docs host, the custom domain, everywhere in the app', () => {
    expect(DOCS_URL).toBe('https://docs.gavel.dualmindlab.tech');
    expect(DOCS_URL).toBe(NOT_FOUND_DOCS_URL);
  });

  it('has no link to the old docs workers.dev host in src', () => {
    const files = walk(join(__dirname, '../../src')).filter((f) => /\.(ts|tsx)$/.test(f));
    const hits = files.filter((f) => readFileSync(f, 'utf8').includes('gavel-docs.creharsh.workers.dev'));
    expect(hits).toEqual([]);
  });
});

describe('needs-review copy (issue 2309)', () => {
  it('does not claim a charge state that is unknown', () => {
    for (const key of ['screen.settleReview', 'console.settlement.reviewNoRunnerUp'] as const) {
      expect(en[key]).not.toMatch(/held, not charged/i);
      expect(en[key]).toMatch(/hold/i);
    }
  });
});
