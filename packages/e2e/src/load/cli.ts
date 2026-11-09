import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { runL3 } from './hammer';
import { runL4 } from './webhooks';
import { runSoak } from './soak';
import type { Check } from './run';
import { rigCounters, startDiagnostics, writeDiagnostics, type Diagnostics } from './diag';
import type { Rig } from '../../test/flow/rig';

// Runs the L3 hammer race, the L4 webhook storm and the L5 soak and writes one JSON report.
//   npx vite-node packages/e2e/src/load/cli.ts -- L3|L4|L5|all [--minutes 30] [--out load.json] [--diag diag.json]
// --diag writes memory samples every 5 s plus per-component counters for the L5 soak (#2203); run
// node with --expose-gc to also get the live heap after a forced collection. Off by default.
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
  const diagFile = flag(argv, '--diag');
  const deps = { now: () => performance.now(), rss: () => process.memoryUsage().rss };
  const results: Result[] = [];
  // The report is rewritten after every scenario, with the peak rss so far, so a crash in a later
  // scenario still leaves the earlier results on disk (#2066).
  const save = (): void => {
    if (out === undefined) return;
    mkdirSync(dirname(out), { recursive: true });
    const report = { peakRssMb: Math.round(process.memoryUsage().rss / 1048576), results };
    writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  };
  save();
  if (which === 'L3' || which === 'all') results.push(await runL3(deps));
  save();
  if (which === 'L4' || which === 'all') results.push(await runL4());
  save();
  if (which === 'L5' || which === 'all') {
    let diag: Diagnostics | undefined;
    results.push(
      await runSoak({
        ...deps,
        durationMs: minutes * 60 * 1000,
        ...(diagFile === undefined
          ? {}
          : {
              onStart: (rig: Rig): void => {
                diag = startDiagnostics({ probe: () => rigCounters(rig) });
              },
              onEnd: (): void => {
                if (diag !== undefined) writeDiagnostics(diagFile, diag.finish());
              },
            }),
      }),
    );
  }
  save();
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
