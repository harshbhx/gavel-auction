import { MemoryHoldStore } from '../../src/stores/memory.js';
import { reconcile, type ReconcileReport } from '../../src/reconcile/reconcile.js';
import {
  fakeDemoEnv,
  runCrashResume,
  sandboxDemoEnv,
  type DemoEnv,
  type DemoResult,
} from '../../demo/settle-with-crash.js';

/**
 * Crash between capture and journal save (T-PAY-094; R-PAY-060).
 *
 * `checkCrashResume(env)` kills the settlement right after the capture request is
 * answered, resumes it from the same journal and returns what PayPal holds afterwards.
 * It throws when the result is not: SETTLED, exactly one capture for the winner, the
 * winning amount captured, no capture on any other hold, and a reconcile report with no
 * money finding (missing, extra or mismatched capture, status conflict).
 *
 * Fake: the unit test test/demo/settle.test.ts runs it in CI.
 * Sandbox (manual, not part of CI): set PAYPAL_ENV=sandbox, PAYPAL_CLIENT_ID,
 * PAYPAL_CLIENT_SECRET and DEMO_AUTHS (approved authorizations, see the demo script), then
 *   npx vite-node test/sandbox/crash.sandbox.ts
 * UNVERIFIED until it has run in the sandbox: that PayPal answers the repeated capture
 * request with the first capture (idempotency) or that the truth check finds it.
 */

const MONEY_FINDINGS: ReadonlySet<string> = new Set([
  'MISSING_CAPTURE',
  'EXTRA_CAPTURE',
  'AMOUNT_MISMATCH',
  'STATUS_CONFLICT',
]);

export interface CrashCheck {
  result: DemoResult;
  report: ReconcileReport;
}

export async function checkCrashResume(
  env: DemoEnv,
  log?: (line: string) => void,
): Promise<CrashCheck> {
  const result = await runCrashResume(env, log);
  const fail = (why: string): never => {
    throw new Error(`crash-resume check failed: ${why}`);
  };
  if (result.crashes !== 1) fail(`expected one crash, saw ${result.crashes}`);
  if (result.journal.state !== 'SETTLED') fail(`ended in ${result.journal.state}`);
  const winner = result.journal.winner;
  if (winner === null) return fail('no winner recorded');
  const captured = Object.entries(result.capturedCents).filter(([, c]) => c > 0);
  if (captured.length !== 1) fail(`${captured.length} holds have a capture, expected 1`);
  const only = captured[0];
  if (only === undefined || only[0] !== winner.bidderId) fail('capture is on the wrong hold');
  if (only?.[1] !== winner.amountCents)
    fail(`captured ${only?.[1]}, journal ${winner.amountCents}`);

  const report = await reconcile(
    {
      gateway: env.gateway,
      journals: env.journals,
      holds: new MemoryHoldStore(),
      clock: env.clock,
    },
    env.auctionId,
  );
  const bad = report.findings.filter((f) => MONEY_FINDINGS.has(f.code));
  if (bad.length > 0) fail(`reconcile: ${bad.map((f) => `${f.code} ${f.holdId}`).join(', ')}`);
  return { result, report };
}

/** Manual entry: `--fake` (default) or `--sandbox`. */
export async function main(argv: readonly string[]): Promise<number> {
  const env = argv.includes('--sandbox') ? sandboxDemoEnv(process.env) : fakeDemoEnv();
  const { report } = await checkCrashResume(env, (l) => console.log(l));
  console.log(`reconcile: ${report.findings.length} finding(s), none about money`);
  return 0;
}

if (process.argv[1]?.endsWith('crash.sandbox.ts') === true) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exitCode = 1;
    },
  );
}
