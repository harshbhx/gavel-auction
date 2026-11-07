import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { renderReport } from './report.js';
import { ALL_SCENARIOS, scenario8, type ScenarioResult } from './scenarios.js';

const REPORT = fileURLToPath(
  new URL('../../../../docs/evidence/SIM/SIM-MULTIDAY.md', import.meta.url),
);

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

  // Test-only export for the open datasets (scripts/hf/build-datasets.mjs). Off unless asked for.
  const exportDir = process.env['SIM_EXPORT_DIR'];
  it.skipIf(exportDir === undefined || exportDir === '')(
    'exports the per-lot rows of the 30-day run for the open dataset',
    async () => {
      const dir = exportDir ?? '';
      const s8 = await scenario8();
      mkdirSync(dir, { recursive: true });
      const jsonl = (rows: readonly object[]): string =>
        rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
      const scenarios = [...results]
        .sort((x, y) => x.id.localeCompare(y.id))
        .map((r) => ({
          scenario: r.id,
          title: r.title,
          checks: r.checks.length,
          checksPassed: r.checks.filter((c) => c.ok).length,
        }));
      writeFileSync(join(dir, 'lots.jsonl'), jsonl(s8.export.lots));
      writeFileSync(join(dir, 'holds.jsonl'), jsonl(s8.export.holds));
      writeFileSync(join(dir, 'scenarios.jsonl'), jsonl(scenarios));
      writeFileSync(
        join(dir, 'meta.json'),
        JSON.stringify({ seed: s8.export.seed, startIso: s8.export.startIso, ...s8.numbers }),
      );
      expect(s8.export.lots.length).toBeGreaterThan(0);
    },
  );

  afterAll(() => {
    if (process.env['SIM_MULTIDAY_WRITE'] !== '1') return;
    results.sort((x, y) => x.id.localeCompare(y.id));
    mkdirSync(dirname(REPORT), { recursive: true });
    writeFileSync(REPORT, renderReport(results));
  });
});
