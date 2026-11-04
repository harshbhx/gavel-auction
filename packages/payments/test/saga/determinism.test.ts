import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertFakeInvariants } from '../../src/fake/invariants.js';
import { canonicalJson } from '../../src/types.js';
import { THREE_BIDDERS, drive, enumerate, randomCase } from '../helpers/crashHarness.js';

/**
 * Determinism (R-PAY-150) and invariant reporting (R-PAY-061). With an injected
 * clock and seeded randomness a saga run is reproducible: the same seed gives the
 * same journals, byte for byte, and the same audit trail.
 */

async function bytesOf(seed: number): Promise<{ journal: string; audit: string }> {
  const c = randomCase(seed);
  const labels = await enumerate(c.scenario);
  const crashAt = [seed % Math.max(1, labels.length)];
  const r = await drive(c.scenario, { crashAt, forgetIdempotency: seed % 2 === 0 });
  assertFakeInvariants(r.rig.core);
  return { journal: canonicalJson(r.journal), audit: canonicalJson(r.rig.audits) };
}

describe('T-PAY-050 same seed, same journals', () => {
  it('two runs of one seed are byte-identical', async () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const a = await bytesOf(seed);
      const b = await bytesOf(seed);
      expect(b.journal, `journal of seed ${seed}`).toBe(a.journal);
      expect(b.audit, `audit of seed ${seed}`).toBe(a.audit);
    }
  });

  it('an uninterrupted run is identical every time, timestamps included', async () => {
    const a = await drive(THREE_BIDDERS);
    const b = await drive(THREE_BIDDERS);
    expect(canonicalJson(b.journal)).toBe(canonicalJson(a.journal));
    expect(canonicalJson(b.rig.audits)).toBe(canonicalJson(a.rig.audits));
  });

  it('different seeds give different cases', () => {
    const a = canonicalJson(randomCase(1).scenario.candidates);
    const seen = new Set<string>([a]);
    for (let seed = 2; seed <= 20; seed += 1) {
      seen.add(canonicalJson(randomCase(seed).scenario.candidates));
    }
    expect(seen.size).toBeGreaterThan(10);
  });
});

describe('invariants are checked in every saga test', () => {
  // Pure unit tests of the state machine, plan and payload shapes touch no fake.
  const NO_FAKE = new Set([
    'bridge.test.ts',
    'create.test.ts',
    'emit.test.ts',
    'engine-edges.test.ts',
    'machine.test.ts',
    'plan.test.ts',
  ]);

  it('every saga test that runs against the fake calls assertFakeInvariants', () => {
    const dir = new URL('./', import.meta.url);
    const files = readdirSync(dir).filter((f) => f.endsWith('.test.ts') && !NO_FAKE.has(f));
    expect(files.length).toBeGreaterThan(8);
    for (const f of files) {
      const text = readFileSync(new URL(f, dir), 'utf8');
      expect(text, `${f} must call assertFakeInvariants`).toMatch(/assertFakeInvariants\(/);
    }
  });
});
