// The gate workflows must match docs/GATES.md and must not publish run files (order ids and
// approval links) in artifacts of a public repository.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const dir = '.github/workflows';
const gateFiles = readdirSync(dir).filter((f) => /^gate-.*\.yml$/.test(f));
const docs = readFileSync('docs/GATES.md', 'utf8');

describe('gate workflows', () => {
  it('finds the installed gate workflows', () => {
    assert.ok(gateFiles.includes('gate-g0.yml'));
    assert.ok(gateFiles.includes('gate-g1.yml'));
  });

  it('declares the protecting environment in every gate workflow', () => {
    for (const f of gateFiles) {
      const text = readFileSync(`${dir}/${f}`, 'utf8');
      assert.match(text, /^ {4}environment: sandbox-nightly$/m, f);
    }
  });

  it('names in GATES.md only workflow files that exist', () => {
    const named = [...docs.matchAll(/`((?:\.github|infra)\/workflows\/[\w.-]+)`/g)].map(
      (m) => m[1],
    );
    assert.ok(named.length > 0);
    for (const path of named) assert.ok(existsSync(path), `${path} is named but missing`);
  });

  it('keeps run files and long retention out of the G1 artifact', () => {
    const text = readFileSync(`${dir}/gate-g1.yml`, 'utf8');
    assert.match(text, /^ {12}!docs\/evidence\/\*\*\/\*\.run\.json$/m);
    const days = Number(/retention-days: (\d+)/.exec(text)?.[1]);
    assert.ok(days > 0 && days <= 7);
  });

  it('has no workflow parked outside .github/workflows', () => {
    assert.equal(existsSync('infra/workflows'), false);
  });
});
