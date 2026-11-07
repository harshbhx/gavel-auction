import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { renderReport } from './report.js';
import { ALL_SCENARIOS, type ScenarioResult } from './scenarios.js';

const REPORT = fileURLToPath(new URL('../../../../docs/evidence/SIM/SIM-MULTIDAY.md', import.meta.url));

const results: ScenarioResult[] = [];

describe('multi-day simulated-clock suite (simulates our code against a model of PayPal)', () => {
  for (const run of ALL_SCENARIOS) {
    it(run.name, async () => {
      const result = await run();
      results.push(result);
      const failed = result.checks.filter((c) => !c.ok);
      expect(failed.map((c) => `${c.name}: ${c.detail}`)).toEqual([]);
    });
  }

  it('is reproducible: two runs give the same report', async () => {
    const a = await ALL_SCENARIOS[7]?.();
    const b = await ALL_SCENARIOS[7]?.();
    expect(a).toEqual(b);
  });

  afterAll(() => {
    if (process.env['SIM_MULTIDAY_WRITE'] !== '1') return;
    results.sort((x, y) => x.id.localeCompare(y.id));
    mkdirSync(dirname(REPORT), { recursive: true });
    writeFileSync(REPORT, renderReport(results));
  });
});
