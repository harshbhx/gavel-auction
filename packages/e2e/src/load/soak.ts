import { CONFIG, makeRig, startFakePaypal } from '../../test/flow/rig';
import { tally } from './clients';
import { LIMITS, release, setUp, type Check, type LoadDeps } from './run';
import type { Rig } from '../../test/flow/rig';

// L5 soak (R-QA-030, T-QA-064): 20 bidders keep bidding across fresh auctions for 30 minutes.
// Pass means no lost or duplicate reply, no unhandled rejection and a stable heap: resident memory
// after the first round may not grow by more than LIMITS.rssGrowthMb. Time, memory and the pause
// between rounds are injected, so the unit test runs the same loop with a fake clock.
// Run it with src/load/cli.ts.

export const SOAK_MS = 30 * 60 * 1000;
export const SOAK_BIDDERS = 20;
const MB = 1024 * 1024;

export interface SoakDeps extends LoadDeps {
  durationMs?: number;
  /** Waits between rounds; default 250 ms of real time. */
  pause?: () => Promise<void>;
  /** Forces a collection before each rss reading (cli passes globalThis.gc under `node --expose-gc`), so rss shows retained memory, not garbage waiting for a sweep. */
  gc?: () => void;
  /** Called with each round's fresh rig before the round runs (the diagnostic mode hooks its probes here). */
  onStart?: (rig: Rig) => void | Promise<void>;
  /** Called once after the last round. */
  onEnd?: () => void | Promise<void>;
  /** Called after every finished round with the number of rounds so far. */
  onRound?: (rounds: number) => void;
}

export interface SoakReport {
  scenario: 'L5';
  bidders: number;
  rounds: number;
  sent: number;
  lost: number;
  duplicate: number;
  unhandledRejections: number;
  rssGrowthMb: number;
  checks: Check[];
  ok: boolean;
}

export async function runSoak(deps: SoakDeps): Promise<SoakReport> {
  const durationMs = deps.durationMs ?? SOAK_MS;
  const bidders = deps.bidders ?? SOAK_BIDDERS;
  const pause = deps.pause ?? ((): Promise<void> => new Promise((r) => setTimeout(r, 250)));
  let unhandled = 0;
  const onUnhandled = (): void => {
    unhandled += 1;
  };
  process.on('unhandledRejection', onUnhandled);
  // One fake PayPal server (one origin, one connection pool) for the whole soak; its records are
  // reset after every round, so nothing of a finished auction is kept (#2203).
  const paypal = await startFakePaypal();
  const start = deps.now();
  let baseline = -1;
  let peak = 0;
  let rounds = 0;
  let sent = 0;
  let lost = 0;
  let duplicate = 0;
  try {
    do {
      // Fresh stores and service for every round, released at its end: a finished auction's log,
      // ledger and holds are not kept for the rest of the soak.
      const rig = await makeRig({ paypal });
      await deps.onStart?.(rig);
      const field = await setUp({ ...deps, bidders }, rig);
      for (let step = 1; step <= 3; step += 1) {
        await Promise.all(
          field.bidders.map((b, i) =>
            b.bid(CONFIG.reserve + (step * bidders + i) * CONFIG.minIncrement),
          ),
        );
      }
      const t = tally(field.bidders);
      sent += t.sent;
      lost += t.lost;
      duplicate += t.duplicate;
      rounds += 1;
      deps.onRound?.(rounds);
      deps.gc?.();
      const rss = deps.rss();
      if (baseline < 0) baseline = rss;
      peak = Math.max(peak, rss);
      await release(field);
      paypal.reset();
      await pause();
    } while (deps.now() - start < durationMs);
  } finally {
    await deps.onEnd?.();
    process.off('unhandledRejection', onUnhandled);
    await paypal.stop();
  }
  const rssGrowthMb = Math.max(0, peak - Math.max(0, baseline)) / MB;
  const checks: Check[] = [
    { name: 'no lost bid', ok: lost === 0, detail: `${String(lost)} lost` },
    { name: 'no duplicate reply', ok: duplicate === 0, detail: `${String(duplicate)} duplicate` },
    { name: 'no unhandled rejection', ok: unhandled === 0, detail: `${String(unhandled)} seen` },
    {
      name: 'heap stable',
      ok: rssGrowthMb < LIMITS.rssGrowthMb,
      detail: `${rssGrowthMb.toFixed(1)} MB < ${String(LIMITS.rssGrowthMb)}`,
    },
  ];
  return {
    scenario: 'L5',
    bidders,
    rounds,
    sent,
    lost,
    duplicate,
    unhandledRejections: unhandled,
    rssGrowthMb,
    checks,
    ok: checks.every((c) => c.ok),
  };
}
