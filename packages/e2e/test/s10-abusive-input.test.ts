import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodeClientMsg } from '@gavel/shared';
import { loadScenarioFile } from '../src/index';
import { runLadder } from '../src/runner/ladder';

// T-QA-038 (R-QA-026, R-QA-036): scenario S10 replays hostile frames from the DSL. Room-level
// amount checks and the flood cut live in test/security/abuse.test.ts.

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const scenario = loadScenarioFile(join(ROOT, 'scenarios', 'S10-abusive-input.yaml'));
const fixtures = JSON.parse(
  readFileSync(join(ROOT, 'fixtures', 'frames', 'hostile.json'), 'utf8'),
) as Array<{ name: string; frame: string; code: string }>;

const raws = scenario.steps.flatMap((s) => (s.do === 'send_raw' ? [s.frame] : []));

describe('S10 abusive input', () => {
  it('loads and lists one expected rejection per raw frame', () => {
    const expected = scenario.expect.find((e) => 'rejected' in e);
    expect(raws.length).toBeGreaterThanOrEqual(6);
    expect(expected).toEqual({
      rejected: raws.map(() => ({ actor: 'mallory', code: 'bad_message' })),
    });
  });

  it('refuses every raw frame with the expected code', () => {
    for (const frame of raws) {
      const res = decodeClientMsg(frame);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('bad_message');
    }
  });

  it('keeps the frame fixtures in step with the scenario and refuses each one', () => {
    for (const f of fixtures) {
      expect(raws, f.name).toContain(f.frame);
      const res = decodeClientMsg(f.frame);
      expect(res.ok, f.name).toBe(false);
      if (!res.ok) expect(res.code, f.name).toBe(f.code);
    }
    expect(fixtures.length).toBe(raws.length);
  });

  it('leaves the auction untouched: no bid accepted, nothing captured', () => {
    const plain = { ...scenario, steps: scenario.steps.filter((s) => s.do !== 'send_raw') };
    const result = runLadder(plain);
    expect(result.accepted).toBe(0);
    expect(result.winner).toBeNull();
    expect(result.capturedCents).toBe(0);
  });
});
