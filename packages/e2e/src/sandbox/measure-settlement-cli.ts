import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { DEFAULT_HOLD_MAX_AGE_MS } from '../../../payments/src/config.js';
import { createSettlement } from '../../../payments/src/saga/create.js';
import { runSettlement } from '../../../payments/src/saga/void.js';
import { MemoryJournalStore } from '../../../payments/src/stores/memory.js';
import { summarize, type Percentiles } from '../../../payments/gates/measure.js';
import { availability, env, newRunId, sleep } from './kit.js';
import { sandboxGateway, type LotHold } from './lot.js';
import { openSession } from './session.js';

// End-to-end settlement latency against the real PayPal sandbox (issue 244, R-PAY-152). Each
// sample is one settlement of a lot: `holds` real approved authorizations, one winner. The clock
// starts when the saga is started (the hammer) and stops
//   - CAPTURED: when the saga has journaled the winner's capture (truth check, capture call and
//     journal write are all inside), and
//   - SETTLED: when the saga run returns with every other hold voided.
// Buyer approval of the holds happens before the clock and is not timed. After each sample PayPal
// is read back (untimed): the winner holds one capture for the hammer price and the others are
// VOIDED; a sample that does not match is a failure and is not counted in the percentiles.
// The output holds numbers only (counts and milliseconds): no ids, no headers, no credentials.
// Run: npm run measure:settlement -w @gavel/e2e -- --out <dir>
//   MEASURE_SETTLEMENTS (default 20, 1 to 30), MEASURE_SETTLE_HOLDS (default 6, 2 to 6).

const HOLD_CENTS = 2000;
const PRICE_CENTS = 1500;

function intEnv(name: string, dflt: number, min: number, max: number): number {
  const raw = Number(env[name] ?? dflt);
  return Number.isInteger(raw) && raw >= min && raw <= max ? raw : dflt;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const outIdx = argv.indexOf('--out');
  const out = outIdx >= 0 ? (argv[outIdx + 1] ?? '') : '';
  if (out === '') {
    process.stderr.write('usage: measure-settlement-cli --out <dir>\n');
    return 2;
  }
  if (!availability.ok) {
    process.stdout.write(
      `measure skipped: sandbox secrets missing: ${availability.missing.join(' ')}\n`,
    );
    return 0;
  }
  const settlements = intEnv('MEASURE_SETTLEMENTS', 20, 1, 30);
  const holdCount = intEnv('MEASURE_SETTLE_HOLDS', 6, 2, 6);
  const runId = newRunId('settle');
  const s = await openSession({
    env,
    runId,
    gate: 'QA-MEASURE-SETTLE',
    now: () => Date.now(),
    sleep,
  });
  const gateway = sandboxGateway(env);
  const captured: number[] = [];
  const settled: number[] = [];
  let mismatches = 0;
  let errors = 0;
  let authorizations = 0;

  for (let i = 1; i <= settlements; i += 1) {
    try {
      const bidders = Array.from({ length: holdCount }, (_, k) => `s${i}b${k + 1}`);
      const holds: LotHold[] = [];
      for (const bidderId of bidders) {
        const h = await s.authorize(bidderId, HOLD_CENTS);
        authorizations += 1;
        holds.push({ bidderId, authId: h.authId, orderId: h.orderId, ceilingCents: HOLD_CENTS });
      }
      const auctionId = `${runId}-a${i}`;
      const journals = new MemoryJournalStore();
      const clock = { nowMs: (): number => Date.now() };
      const audit = { append: async (): Promise<void> => undefined };
      const plan: Record<
        string,
        {
          holdId: string;
          authId: string;
          orderId: string;
          ceilingCents: number;
          createdAtMs: number;
        }
      > = {};
      for (const h of holds) {
        plan[h.bidderId] = {
          holdId: `hold-${h.bidderId}`,
          authId: h.authId,
          orderId: h.orderId,
          ceilingCents: h.ceilingCents,
          createdAtMs: clock.nowMs(),
        };
      }
      await createSettlement(
        { journals, clock, holdMaxAgeMs: DEFAULT_HOLD_MAX_AGE_MS, audit },
        {
          auctionId,
          reserveCents: 100,
          candidates: bidders.map((bidderId, k) => ({ bidderId, priceCents: PRICE_CENTS - k })),
          holds: plan,
        },
      );
      let tCaptured = -1;
      const t0 = performance.now();
      const boundary = (label: string): void => {
        if (tCaptured < 0 && label === 'journaled:capture_ok') tCaptured = performance.now() - t0;
      };
      const outcome = await runSettlement({ journals, gateway, audit, clock, boundary }, auctionId);
      const tSettled = performance.now() - t0;

      // Untimed read-back of PayPal.
      let ok = outcome.status === 'settled';
      let winnerCaptures = 0;
      let voided = 0;
      for (const h of holds) {
        const t = await gateway.getHoldTruth({
          holdId: `hold-${h.bidderId}`,
          authId: h.authId,
          orderId: h.orderId,
        });
        if (t.capturedCents > 0) winnerCaptures += 1;
        else if (t.status === 'VOIDED') voided += 1;
      }
      ok = ok && winnerCaptures === 1 && voided === holdCount - 1 && tCaptured >= 0;
      if (ok) {
        captured.push(Math.round(tCaptured * 100) / 100);
        settled.push(Math.round(tSettled * 100) / 100);
      } else {
        mismatches += 1;
        process.stdout.write(
          `settlement ${i}: PayPal state did not match (status ${outcome.status})\n`,
        );
      }
    } catch (e) {
      errors += 1;
      process.stdout.write(`settlement ${i} failed: ${e instanceof Error ? e.name : 'error'}\n`);
    }
  }

  const failures = mismatches + errors;
  const hammerToCaptured: Percentiles = summarize(captured, failures);
  const hammerToSettled: Percentiles = summarize(settled, failures);
  const lines = [
    '| span | n | failed | p50 ms | p95 ms | p99 ms | max ms |',
    '|------|---|--------|--------|--------|--------|--------|',
  ];
  const rows: [string, Percentiles][] = [
    ['hammer to CAPTURED', hammerToCaptured],
    ['hammer to SETTLED', hammerToSettled],
  ];
  for (const [name, p] of rows) {
    lines.push(
      `| ${name} | ${p.count} | ${p.failures} | ${p.p50} | ${p.p95} | ${p.p99} | ${p.max} |`,
    );
  }
  const table = lines.join('\n');
  const report = {
    v: 1,
    env: 'sandbox',
    settlements,
    holdsPerSettlement: holdCount,
    voidConcurrency: 3,
    authorizationsUsed: authorizations,
    hammerToCaptured,
    hammerToSettled,
    mismatches,
    errors,
    table,
  };
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'measure-settlement.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(out, 'measure-settlement.md'), `${table}\n`);
  process.stdout.write(`${table}\nauthorizations used: ${authorizations}\n`);
  return failures === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    process.stderr.write(`measure failed: ${e instanceof Error ? e.name : 'error'}\n`);
    process.exit(1);
  },
);
