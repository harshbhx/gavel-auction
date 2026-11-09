import { availability, env } from './kit.js';
import { runServerKill } from './server-kill.js';

// Real server process kill and restart against the real PayPal sandbox (issue 2185).
// Run: npm run kill:server -w @gavel/e2e -- --out <dir> [--fake]
// --fake runs the same harness against the fake PayPal; its output says so and is not evidence.

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const outIdx = argv.indexOf('--out');
  const out = outIdx >= 0 ? (argv[outIdx + 1] ?? '') : '';
  const fake = argv.includes('--fake');
  if (out === '') {
    process.stderr.write('usage: server-kill-cli --out <dir> [--fake]\n');
    return 2;
  }
  if (!fake) {
    const missing = [...availability.missing];
    if ((env['PAYPAL_WEBHOOK_ID'] ?? '') === '') missing.push('PAYPAL_WEBHOOK_ID');
    if (!availability.ok || missing.length > 0) {
      process.stdout.write(
        `SERVER KILL VERDICT: NOT RUN (sandbox secrets missing: ${missing.join(' ')})\n`,
      );
      return 0;
    }
  }
  const runUrl =
    env['GITHUB_SERVER_URL'] && env['GITHUB_REPOSITORY'] && env['GITHUB_RUN_ID']
      ? `${env['GITHUB_SERVER_URL']}/${env['GITHUB_REPOSITORY']}/actions/runs/${env['GITHUB_RUN_ID']}`
      : '';
  const { verdict, evidence } = await runServerKill({
    mode: fake ? 'fake' : 'sandbox',
    outDir: out,
    env,
    runUrl,
  });
  for (const c of evidence.checks) {
    process.stdout.write(`${c.pass ? 'pass' : 'FAIL'}: ${c.name} (${c.detail})\n`);
  }
  process.stdout.write(
    `SERVER KILL VERDICT: ${verdict} (pid ${evidence.pidBefore} then ${evidence.pidAfter}, ${evidence.winnerCaptures} capture, ${evidence.voidedLosers} voided, journal diffs ${evidence.journalDiffs}, ledger ${evidence.ledger.entries} entries)\n`,
  );
  return verdict === 'PASS' ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    process.stderr.write(`server kill failed: ${e instanceof Error ? e.message : 'error'}\n`);
    process.exit(1);
  },
);
