import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { runL3 } from './hammer';
import { runL4 } from './webhooks';
import { runSoak } from './soak';
import type { Check } from './run';

// Runs the L3 hammer race, the L4 webhook storm and the L5 soak and writes one JSON report.
//   npx vite-node packages/e2e/src/load/cli.ts -- L3|L4|L5|all [--minutes 30] [--out load.json]
// Exit code 1 when any check fails.

interface Result {
  scenario: string;
  ok: boolean;
  checks: Check[];
}

function flag(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(argv: readonly string[]): Promise<number> {
  const which = argv.find((a) => a === 'L3' || a === 'L4' || a === 'L5' || a === 'all') ?? 'all';
  const minutes = Number(flag(argv, '--minutes') ?? '30');
  const out = flag(argv, '--out');
  const deps = { now: () => performance.now(), rss: () => process.memoryUsage().rss };
  const results: Result[] = [];
  if (which === 'L3' || which === 'all') results.push(await runL3(deps));
  if (which === 'L4' || which === 'all') results.push(await runL4());
  if (which === 'L5' || which === 'all') {
    results.push(await runSoak({ ...deps, durationMs: minutes * 60 * 1000 }));
  }
  if (out !== undefined) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`);
  }
  for (const r of results) {
    process.stdout.write(`${r.scenario} ${r.ok ? 'pass' : 'FAIL'}\n`);
    for (const c of r.checks)
      process.stdout.write(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}: ${c.detail}\n`);
  }
  return results.every((r) => r.ok) ? 0 : 1;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    process.exit(1);
  },
);
