import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluate, ratchetDocumented } from '../check-coverage.mjs';

const file = (pkg, covered, total) => [
  `/repo/packages/${pkg}/src/a.ts`,
  { lines: { covered, total }, branches: { covered, total } },
];
const gates = { engine: { lines: 95, branches: 90 } };

describe('coverage gate', () => {
  it('fails when a package is below its gate (no advisory mode)', () => {
    const { failed } = evaluate(Object.fromEntries([file('engine', 40, 100)]), gates);
    assert.equal(failed, true);
  });

  it('passes when the package meets its gate', () => {
    const { failed } = evaluate(Object.fromEntries([file('engine', 96, 100)]), gates);
    assert.equal(failed, false);
  });

  it('fails when a configured package has no instrumented sources', () => {
    const { failed, rows } = evaluate(Object.fromEntries([file('other', 100, 100)]), gates);
    assert.equal(failed, true);
    assert.match(rows[0][4], /no instrumented sources/);
  });

  it('ignores the engine advisory flag if one is reintroduced', () => {
    const { failed } = evaluate(Object.fromEntries([file('engine', 40, 100)]), {
      engine: { lines: 95, branches: 90, advisory: true },
    });
    assert.equal(failed, true);
  });
});

describe('ratchet exemption', () => {
  const lowered = [{ pkg: 'voice', metric: 'branches', next: 40 }];
  const diff = (...added) => ['--- a/docs/DECISIONS.md', ...added.map((l) => `+${l}`)].join('\n');

  it('rejects a bare coverage threshold line', () => {
    assert.equal(ratchetDocumented(diff('- coverage threshold'), lowered), false);
  });

  it('rejects a comment inside a fenced block', () => {
    const d = diff('## D-0100', '```', '# voice branches 40', '```');
    assert.equal(ratchetDocumented(d, lowered), false);
  });

  it('rejects an entry that does not name the lowered package and value', () => {
    const d = diff('## D-0100: coverage threshold', 'engine lines lowered to 90');
    assert.equal(ratchetDocumented(d, lowered), false);
  });

  it('accepts a new D-id entry naming package, metric and new value', () => {
    const d = diff('## D-0100: coverage threshold', 'voice branches lowered from 80 to 40');
    assert.equal(ratchetDocumented(d, lowered), true);
  });
});
