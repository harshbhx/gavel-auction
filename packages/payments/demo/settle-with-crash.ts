import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkCrashResume } from '../test/sandbox/crash.sandbox.js';
import { fakeDemoEnv, runCrashResume, sandboxDemoEnv } from './settle-lib.js';

/**
 * Settlement with a crash and a resume (SPEC 6.2; R-PAY-060, R-PAY-061).
 *
 * `npm run demo:settle` (fake, the default) or `npm run demo:settle -- --sandbox`.
 * Add `--check` to run the T-PAY-094 assertions (one capture, clean reconcile) instead.
 *
 * The run settles one lot with three bidders. The process "dies" right after the
 * capture request is answered and before the journal records it: the exact window
 * where a retry could charge twice. A new run starts from the same journal file, reads
 * PayPal's truth, adopts the capture it finds and finishes. The script prints the
 * ladder (held, charged, released) for every bidder at each stage and the number of
 * captures PayPal holds for the winner, which must be one.
 *
 * Sandbox mode needs PAYPAL_ENV=sandbox, PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET and
 * DEMO_AUTHS, a comma list of bidder:authorizationId:ceilingCents with already approved
 * authorizations (one per bidder, ceilings above the prices below). The sandbox guard
 * runs before any request is made.
 */

async function main(argv: readonly string[], vars: Record<string, string | undefined>) {
  const sandbox = argv.includes('--sandbox');
  const env = sandbox ? sandboxDemoEnv(vars) : fakeDemoEnv();
  if (argv.includes('--check')) {
    const { report } = await checkCrashResume(env, (l) => console.log(l));
    console.log(
      `check ok (T-PAY-094): ${report.findings.length} reconcile finding(s), none about money`,
    );
    return 0;
  }
  const result = await runCrashResume(env, (l) => console.log(l));
  const charged = Object.values(result.capturedCents).filter((c) => c > 0).length;
  if (result.journal.state !== 'SETTLED' || charged !== 1) {
    console.error('demo failed: expected SETTLED with exactly one capture');
    return 1;
  }
  console.log('ok: crash survived, exactly one capture');
  return 0;
}

// vite-node drops the script from argv, so its own binary name marks the entry run.
const isEntry =
  /vite-node/.test(process.argv[1] ?? '') ||
  process.argv.slice(1).some((a) => pathToFileURL(resolve(a)).href === import.meta.url);
if (isEntry) {
  main(process.argv.slice(2), process.env).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exitCode = 1;
    },
  );
}
