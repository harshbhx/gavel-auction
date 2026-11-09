import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { composeServer } from '../src/boot/compose';

/**
 * Webhook handler latency without the verify call (issue 2191, target in docs/GATES.md: handler
 * answers 200 within 300 ms without asking PayPal to verify). The server is composed in fake
 * payments mode and listens on loopback. Each request is a POST /webhooks/paypal with an event
 * type the intake ignores, which the handler answers 200 without a verify call. What is measured:
 * our route and handler, one HTTP exchange on loopback, the client clock (performance.now). It is
 * not the hosted host, not the network and not PayPal. Sequential, no retries.
 *
 * Run: npx vite-node bench/webhook-handler.ts -- --out <dir> [--n 500]
 */

export const TARGET_MS = 300;
export const IGNORED_EVENT_TYPE = 'CHECKOUT.ORDER.APPROVED';

export interface WebhookBenchReport {
  v: 1;
  kind: 'webhook-handler';
  label: string;
  n: number;
  statusCounts: Record<string, number>;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  targetMs: number;
  verdict: 'MET' | 'MISSED' | 'INVALID';
}

export function nearestRank(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(sorted.length, rank) - 1] ?? 0;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Report from raw samples. INVALID when any answer was not 200 or there are no samples. */
export function buildReport(
  samplesMs: readonly number[],
  statusCounts: Record<string, number>,
): WebhookBenchReport {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const bad = Object.entries(statusCounts).some(([s, c]) => s !== '200' && c > 0);
  const p95 = round2(nearestRank(sorted, 95));
  return {
    v: 1,
    kind: 'webhook-handler',
    label:
      'our route and handler on loopback; the event type is ignored so no verify call is made; network and PayPal not included',
    n: sorted.length,
    statusCounts,
    p50Ms: round2(nearestRank(sorted, 50)),
    p95Ms: p95,
    p99Ms: round2(nearestRank(sorted, 99)),
    maxMs: round2(sorted[sorted.length - 1] ?? 0),
    targetMs: TARGET_MS,
    verdict: bad || sorted.length === 0 ? 'INVALID' : p95 <= TARGET_MS ? 'MET' : 'MISSED',
  };
}

export async function runWebhookBench(opts: { n?: number } = {}): Promise<WebhookBenchReport> {
  const n = opts.n ?? 500;
  const app = await composeServer(
    {
      PUBLIC_URL: 'http://localhost:8080',
      TOKEN_SECRET: 'bench-secret-bench-secret-bench-secret-01',
      ADMIN_KEY: 'bench-admin-key-bench-admin-key-01',
      PAYMENTS: 'fake',
      LOG_LEVEL: 'error',
    },
    { sink: () => undefined },
  );
  try {
    const port = await app.listen(0);
    const url = `http://127.0.0.1:${port}/webhooks/paypal`;
    const samples: number[] = [];
    const statusCounts: Record<string, number> = {};
    for (let i = 0; i < n; i += 1) {
      const body = JSON.stringify({
        id: `WH-BENCH-${i}`,
        event_type: IGNORED_EVENT_TYPE,
        resource: { id: `O-${i}` },
      });
      const t0 = performance.now();
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'paypal-transmission-id': `TX-${i}`,
        },
        body,
      });
      await res.arrayBuffer();
      const ms = performance.now() - t0;
      samples.push(ms);
      statusCounts[String(res.status)] = (statusCounts[String(res.status)] ?? 0) + 1;
    }
    return buildReport(samples, statusCounts);
  } finally {
    await app.close();
  }
}

function flag(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

const isEntry =
  /vite-node/.test(process.argv[1] ?? '') ||
  process.argv.slice(1).some((a) => pathToFileURL(resolve(a)).href === import.meta.url);
if (isEntry) {
  const argv = process.argv.slice(2);
  const out = flag(argv, '--out');
  const n = Number(flag(argv, '--n') ?? '500');
  if (out === undefined || !Number.isInteger(n) || n < 1 || n > 5000) {
    console.error('usage: webhook-handler.ts --out <dir> [--n 1..5000]');
    process.exitCode = 2;
  } else {
    runWebhookBench({ n }).then(
      (r) => {
        mkdirSync(out, { recursive: true });
        writeFileSync(join(out, 'webhook-handler.json'), `${JSON.stringify(r, null, 2)}\n`);
        console.log(JSON.stringify(r));
        console.log(
          `WEBHOOK HANDLER VERDICT: ${r.verdict} (p95 ${r.p95Ms} ms vs ${r.targetMs}, n=${r.n}, loopback, verify call not made)`,
        );
        process.exitCode = r.verdict === 'INVALID' ? 1 : 0;
      },
      (e: unknown) => {
        console.error(e instanceof Error ? e.message : String(e));
        process.exitCode = 1;
      },
    );
  }
}
