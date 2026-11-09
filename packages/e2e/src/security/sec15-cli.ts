import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScenarioFile } from '../dsl/load';
import { runScenarioInStack } from '../runner/stack-driver';

/**
 * SEC-15 log scan driver (issue 2188). Runs scenario S01 on the real server process (stack mode,
 * fake PayPal in its own process), with the server's stdout and stderr captured to `server.log`.
 * The caller puts canary values into the environment first (see .github/workflows/evidence-log-
 * scan.yml); the server inherits them, so a leak into the log is recognisable. After S01 this
 * sends a few probe requests that carry canary values in headers, query and body, then copies
 * the server data folder (store and audit files) next to the log. scripts/scan-logs.mjs scans
 * the result. Nothing here prints a canary value.
 *
 * Run: GAVEL_E2E_SERVER_LOG=<out>/server.log vite-node src/security/sec15-cli.ts --out <out>
 */

const SCENARIO = fileURLToPath(new URL('../../scenarios/S01-happy-path.yaml', import.meta.url));

/** Canary variables that must be set before this runs; the scanner reads the same names. */
export const CANARY_ENV = [
  'GAVEL_E2E_ADMIN_KEY',
  'GAVEL_E2E_TOKEN_SECRET',
  'JUDGE_KEY',
  'PAYPAL_CLIENT_SECRET',
  'PAYPAL_CLIENT_ID',
  'PAYPAL_WEBHOOK_ID',
  'CANARY_BUYER_EMAIL',
  'CANARY_CARD_NUMBER',
  'CANARY_BEARER',
] as const;

interface ProbeResult {
  name: string;
  status: number | 'error';
}

async function probe(name: string, run: () => Promise<Response>): Promise<ProbeResult> {
  try {
    const res = await run();
    await res.arrayBuffer();
    return { name, status: res.status };
  } catch {
    return { name, status: 'error' };
  }
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const outIdx = argv.indexOf('--out');
  const out = outIdx >= 0 ? resolve(argv[outIdx + 1] ?? '') : '';
  if (out === '' || argv[outIdx + 1] === undefined) {
    process.stderr.write('usage: sec15-cli --out <dir>\n');
    return 2;
  }
  const missing = CANARY_ENV.filter((n) => (process.env[n] ?? '').length < 16);
  if (missing.length > 0) {
    process.stdout.write(
      `SEC-15 LOG SCAN VERDICT: NOT RUN (canary variables not set: ${missing.join(' ')})\n`,
    );
    return 2;
  }
  if ((process.env['GAVEL_E2E_SERVER_LOG'] ?? '') === '') {
    process.stderr.write('GAVEL_E2E_SERVER_LOG must name the file that receives the server log\n');
    return 2;
  }
  mkdirSync(out, { recursive: true });

  const env = process.env as Record<string, string>;
  const scenario = loadScenarioFile(SCENARIO);
  const probes: ProbeResult[] = [];
  const result = await runScenarioInStack(
    { ...scenario, modes: ['stack'] },
    {
      beforeStop: async (stack) => {
        const base = stack.serverUrl;
        const qs = `email=${encodeURIComponent(env['CANARY_BUYER_EMAIL'] ?? '')}&card=${env['CANARY_CARD_NUMBER'] ?? ''}`;
        probes.push(
          await probe('healthz', () => fetch(`${base}/healthz`)),
          await probe('canary query string and bad bearer on a lookup', () =>
            fetch(`${base}/api/auctions/none?${qs}`, {
              headers: { authorization: `Bearer ${env['CANARY_BEARER'] ?? ''}` },
            }),
          ),
          await probe('bad invite carrying a canary email and card in the body', () =>
            fetch(`${base}/api/auctions/none/join`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                invite: env['CANARY_BEARER'] ?? '',
                email: env['CANARY_BUYER_EMAIL'] ?? '',
                card: env['CANARY_CARD_NUMBER'] ?? '',
              }),
            }),
          ),
          await probe('judge room create with the judge key header', () =>
            fetch(`${base}/api/judge/rooms`, {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'x-judge-key': env['JUDGE_KEY'] ?? '',
              },
              body: '{}',
            }),
          ),
          await probe('admin export with the admin key header', () =>
            fetch(`${base}/admin/export?auction=none`, {
              headers: { 'x-admin-key': stack.adminKey },
            }),
          ),
          await probe('admin route with a wrong key', () =>
            fetch(`${base}/admin/export?auction=none`, {
              headers: { 'x-admin-key': env['CANARY_BEARER'] ?? '' },
            }),
          ),
        );
        // Store and audit files, scanned for canaries only (they hold tokens and names on purpose).
        cpSync(stack.dataDir, join(out, 'store'), { recursive: true });
      },
    },
  );
  const summary = {
    scenario: scenario.id,
    mode: 'stack',
    seed: result.seed,
    scenarioFailures: result.failures,
    accepted: result.outcome.accepted,
    winner: result.outcome.winner,
    capturedCents: result.outcome.capturedCents,
    probes,
  };
  writeFileSync(join(out, 'run.json'), `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(
    `S01 on the real server: ${result.failures.length === 0 ? 'scenario checks passed' : `${result.failures.length} scenario failure(s)`}, ${probes.length} probes sent\n`,
  );
  return result.failures.length === 0 ? 0 : 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  },
);
