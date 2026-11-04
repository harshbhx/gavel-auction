import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluate } from '../check-coverage.mjs';

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
