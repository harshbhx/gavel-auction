// A gates-result flag may be on only when docs/GATES.md records the matching closed gate.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkGatesResult, parseGateSections } from '../check-gates-result.mjs';

const OFF = { g1_remainder_mode: 'unknown', g2_card_authorize: false, g4_webhooks_verified: false };

function md(gate, fields) {
  const lines = Object.entries(fields).map(([k, v]) => `${k}: ${v}`);
  return `# Gates\n\n## ${gate}: title\n\n${lines.join('\n')}\n\n## Latency targets\n\nStatus: PASS\n`;
}

describe('check-gates-result', () => {
  it('passes with every flag off and no recorded gate', () => {
    assert.deepEqual(checkGatesResult(OFF, md('G2', { Status: 'NOT RUN', Decision: 'n/a' })), []);
  });

  it('fails when a flag is on and the gate was never run', () => {
    const flags = { ...OFF, g2_card_authorize: true };
    const problems = checkGatesResult(flags, md('G2', { Status: 'NOT RUN', Decision: 'n/a' }));
    assert.equal(problems.length, 1);
    assert.match(problems[0], /g2_card_authorize is true but G2/);
  });

  it('fails when a flag is on without a Decision or an Evidence line', () => {
    const flags = { ...OFF, g4_webhooks_verified: true };
    const noDecision = md('G4', { Status: 'PASS', Decision: 'n/a', Evidence: 'x' });
    assert.match(checkGatesResult(flags, noDecision)[0], /no recorded Decision/);
    const noEvidence = md('G4', { Status: 'PASS', Decision: 'ship it' });
    assert.match(checkGatesResult(flags, noEvidence)[0], /no Evidence line/);
  });

  it('passes when the matching gate is closed with evidence', () => {
    const flags = { ...OFF, g2_card_authorize: true };
    const ok = md('G2', { Status: 'PASS', Decision: 'card enabled', Evidence: 'docs/evidence/x' });
    assert.deepEqual(checkGatesResult(flags, ok), []);
  });

  it('requires a closed G1 entry for a remainder mode', () => {
    const flags = { ...OFF, g1_remainder_mode: 'A' };
    assert.match(checkGatesResult(flags, md('G1', { Status: 'NOT RUN' }))[0], /g1_remainder_mode/);
    const ok = md('G1', { Status: 'PASS', Decision: 'mode A', Evidence: 'docs/evidence/y' });
    assert.deepEqual(checkGatesResult(flags, ok), []);
  });

  it('accepts a generated G1 entry that carries a Status line', () => {
    const flags = { ...OFF, g1_remainder_mode: 'A' };
    const tmpl = '## G1: partial capture\n\nStatus: NOT RUN\nDecision: n/a\n\n';
    const gen =
      '## G1 partial capture  (run G1-1)\nStatus: PASS\nEvidence: e (sha256 x)\nDecision: PASS\n';
    assert.deepEqual(checkGatesResult(flags, tmpl + gen), []);
  });

  it('does not let a FAIL entry without a fallback back a remainder mode', () => {
    const flags = { ...OFF, g1_remainder_mode: 'A' };
    const fail = md('G1', { Status: 'FAIL', Decision: 'x', Evidence: 'y' });
    assert.match(checkGatesResult(flags, fail)[0], /no adopted fallback/);
    const withFallback = md('G1', {
      Status: 'FAIL',
      Decision: 'x',
      Evidence: 'y',
      'Fallback adopted': 'void explicitly',
    });
    assert.deepEqual(checkGatesResult(flags, withFallback), []);
  });

  it('rejects unknown or mistyped flags', () => {
    assert.equal(checkGatesResult({ ...OFF, extra: true }, '').length, 1);
    assert.equal(checkGatesResult({ ...OFF, g2_card_authorize: 'yes' }, '').length, 1);
  });

  it('reads sections up to the next heading only', () => {
    const s = parseGateSections(md('G3', { Status: 'FAIL' }));
    assert.equal(s.G3.status, 'FAIL');
    assert.equal(Object.keys(s).length, 1);
  });

  it('accepts the committed files', async () => {
    const { readFileSync } = await import('node:fs');
    const flags = JSON.parse(readFileSync('packages/payments/src/gates-result.json', 'utf8'));
    assert.deepEqual(checkGatesResult(flags, readFileSync('docs/GATES.md', 'utf8')), []);
  });
});
