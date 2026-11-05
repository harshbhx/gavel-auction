import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { activeWaivers, evaluateAudit } from '../check-audit.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const NOW = Date.parse('2026-11-05T12:00:00Z');
const report = (...vs) => ({
  vulnerabilities: Object.fromEntries(vs.map((v) => [v.name, v])),
});
const high = { name: 'left-pad', severity: 'high' };
const low = { name: 'tiny', severity: 'low' };

describe('audit gate (T-QA-077)', () => {
  it('passes a clean report and ignores low and moderate advisories', () => {
    assert.equal(evaluateAudit(report(), [], NOW).ok, true);
    assert.equal(evaluateAudit(report(low, { name: 'm', severity: 'moderate' }), [], NOW).ok, true);
  });

  it('fails on a high advisory without a waiver', () => {
    const r = evaluateAudit(report(high), [], NOW);
    assert.equal(r.ok, false);
    assert.deepEqual(r.blocking, ['left-pad (high)']);
  });

  it('accepts a high advisory under an active waiver, through its last day', () => {
    const w = [{ package: 'left-pad', reason: 'no fix yet', expires: '2026-11-05' }];
    assert.equal(evaluateAudit(report(high), w, NOW).ok, true);
    assert.deepEqual(evaluateAudit(report(high), w, NOW).waived, ['left-pad']);
  });

  it('stops honouring a waiver the day after it expires', () => {
    const w = [{ package: 'left-pad', reason: 'no fix yet', expires: '2026-11-04' }];
    const r = evaluateAudit(report(high), w, NOW);
    assert.equal(r.ok, false);
    assert.equal(r.expired.length, 1);
  });

  it('rejects a waiver without a reason or with a bad date', () => {
    assert.throws(() => activeWaivers([{ package: 'a', reason: '', expires: '2026-12-01' }], NOW));
    assert.throws(() => activeWaivers([{ package: 'a', reason: 'x', expires: 'soon' }], NOW));
  });

  it('keeps the committed waiver file well formed', () => {
    const file = JSON.parse(readFileSync(join(root, 'audit-waivers.json'), 'utf8'));
    assert.ok(Array.isArray(file.waivers));
    activeWaivers(file.waivers, NOW);
  });
});
