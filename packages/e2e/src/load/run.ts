import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { AuctionService, Connection } from '@gavel/server';
import type { AuctionId, BidderId, ConnId, MsgId } from '@gavel/shared';
import { CONFIG, makeRig, type Rig } from '../../test/flow/rig';
import { SimulatedBidder, TimedTransport, tally, type Now, type Tally } from './clients';

// Load harness (R-QA-030, R-QA-040).
//   L1: 100 simulated bidders send bids at the same time, in several rounds.
//   L2: all of them send the identical bid at the same moment; exactly one may win.
// The simulated bidders talk to the room in process through a timed transport, the engine,
// the ledger and the fake PayPal are the real code. Time and memory are injected, so the unit
// test can run the same code with a fixed clock; the real run uses performance.now and the
// process RSS:
//   GAVEL_LOAD_RUN=1 npx vite-node packages/e2e/src/load/run.ts -- all --out load-latency.json

export const LIMITS = {
  p95AckMs: 250,
  p99AckMs: 600,
  rssGrowthMb: 150,
} as const;

export interface LoadDeps {
  now: Now;
  /** Resident set size in bytes. */
  rss: () => number;
  bidders?: number;
  rounds?: number;
}

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export interface LoadReport {
  scenario: 'L1' | 'L2';
  bidders: number;
  sent: number;
  accepted: number;
  rejected: number;
  lost: number;
  duplicate: number;
  rssGrowthMb: number;
  latency: ReturnType<Tally['latency']['toJSON']>;
  checks: Check[];
  ok: boolean;
}

const BIDDERS = 100;
const ROUNDS = 3;
const LADDER_STEPS = 40;
const MB = 1024 * 1024;

export interface Field {
  rig: Rig;
  room: Awaited<ReturnType<AuctionService['createAuction']>>;
  bidders: SimulatedBidder[];
}

/** Opens one auction with `bidders` registered, holding bidders on `rig` (a fresh rig by default). */
export async function setUp(deps: LoadDeps, shared?: Rig): Promise<Field> {
  const rig = shared ?? (await makeRig());
  const service = rig.service();
  const auctionId: AuctionId = rig.ids.mint<'AuctionId'>();
  const room = await service.createAuction(auctionId, CONFIG, 'auctioneer-sub');
  const bidders: SimulatedBidder[] = [];
  const count = deps.bidders ?? BIDDERS;
  for (let i = 0; i < count; i += 1) {
    const id: BidderId = rig.ids.mint<'BidderId'>();
    const created = await rig.holdsApi.createHoldOrder({
      auctionId,
      bidderId: id,
      ceilingCents: 30000,
      presetsCents: CONFIG.ceilingPresets,
    });
    rig.paypal.core.approveOrder(created.orderId);
    await rig.holdsApi.completeApproval({ holdId: created.holdId, orderId: created.orderId });
    await service.registerBidder({
      auctionId,
      bidderId: id,
      name: `bidder-${String(i + 1)}`,
      holdId: created.holdId,
    });
    const transport = new TimedTransport(deps.now);
    const conn: Connection = {
      id: rig.ids.mint<'ConnId'>() as ConnId,
      role: 'bidder',
      sub: id,
      transport,
      bidderId: id,
    };
    await room.attach(conn);
    const mint = (): MsgId => rig.ids.mint<'MsgId'>();
    bidders.push(new SimulatedBidder(id, conn, transport, room, mint, deps.now));
  }
  return { rig, room, bidders };
}

function report(
  scenario: 'L1' | 'L2',
  t: Tally,
  count: number,
  rssGrowthMb: number,
  extra: Check[],
): LoadReport {
  const p95 = t.latency.percentile(95);
  const p99 = t.latency.percentile(99);
  const checks: Check[] = [
    {
      name: 'p95 ack',
      ok: p95 < LIMITS.p95AckMs,
      detail: `${String(p95)} ms < ${String(LIMITS.p95AckMs)}`,
    },
    {
      name: 'p99 ack',
      ok: p99 < LIMITS.p99AckMs,
      detail: `${String(p99)} ms < ${String(LIMITS.p99AckMs)}`,
    },
    { name: 'no lost bid', ok: t.lost === 0, detail: `${String(t.lost)} lost` },
    {
      name: 'no duplicate reply',
      ok: t.duplicate === 0,
      detail: `${String(t.duplicate)} duplicate`,
    },
    {
      name: 'rss growth',
      ok: rssGrowthMb < LIMITS.rssGrowthMb,
      detail: `${rssGrowthMb.toFixed(1)} MB < ${String(LIMITS.rssGrowthMb)}`,
    },
    ...extra,
  ];
  return {
    scenario,
    bidders: count,
    sent: t.sent,
    accepted: t.accepted,
    rejected: t.rejected,
    lost: t.lost,
    duplicate: t.duplicate,
    rssGrowthMb,
    latency: t.latency.toJSON(),
    checks,
    ok: checks.every((c) => c.ok),
  };
}

/** L1: every bidder bids in every round, all at once; the room must answer each bid once. */
export async function runL1(deps: LoadDeps): Promise<LoadReport> {
  const before = deps.rss();
  const field = await setUp(deps);
  try {
    const count = field.bidders.length;
    const rounds = deps.rounds ?? ROUNDS;
    for (let r = 0; r < rounds; r += 1) {
      await Promise.all(
        field.bidders.map((b, i) =>
          b.bid(CONFIG.reserve + ((r * count + i) % LADDER_STEPS) * CONFIG.minIncrement),
        ),
      );
    }
    const t = tally(field.bidders);
    const growth = Math.max(0, deps.rss() - before) / MB;
    return report('L1', t, count, growth, [
      {
        name: 'every bid answered',
        ok: t.accepted + t.rejected === count * rounds,
        detail: `${String(t.accepted + t.rejected)} of ${String(count * rounds)}`,
      },
      { name: 'some bid accepted', ok: t.accepted > 0, detail: `${String(t.accepted)} accepted` },
    ]);
  } finally {
    await field.rig.paypal.stop();
  }
}

/** L2: all bidders send the same amount at the same moment; exactly one is accepted. */
export async function runL2(deps: LoadDeps): Promise<LoadReport> {
  const before = deps.rss();
  const field = await setUp(deps);
  try {
    const amount = CONFIG.reserve + 4 * CONFIG.minIncrement;
    await Promise.all(field.bidders.map((b) => b.bid(amount)));
    const t = tally(field.bidders);
    const growth = Math.max(0, deps.rss() - before) / MB;
    return report('L2', t, field.bidders.length, growth, [
      {
        name: 'exactly one winner',
        ok: t.accepted === 1,
        detail: `${String(t.accepted)} accepted`,
      },
      {
        name: 'all others rejected',
        ok: t.rejected === field.bidders.length - 1,
        detail: `${String(t.rejected)} rejected`,
      },
    ]);
  } finally {
    await field.rig.paypal.stop();
  }
}

export function writeLatency(path: string, reports: readonly LoadReport[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ limits: LIMITS, reports }, null, 2)}\n`);
}

export async function main(argv: readonly string[]): Promise<number> {
  const which = argv.find((a) => a === 'L1' || a === 'L2' || a === 'all') ?? 'all';
  const outIndex = argv.indexOf('--out');
  const out = outIndex >= 0 ? argv[outIndex + 1] : undefined;
  const deps: LoadDeps = { now: () => performance.now(), rss: () => process.memoryUsage().rss };
  const reports: LoadReport[] = [];
  if (which === 'L1' || which === 'all') reports.push(await runL1(deps));
  if (which === 'L2' || which === 'all') reports.push(await runL2(deps));
  if (out !== undefined) writeLatency(out, reports);
  for (const r of reports) {
    process.stdout.write(`${r.scenario} ${r.ok ? 'pass' : 'FAIL'}\n`);
    for (const c of r.checks)
      process.stdout.write(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}: ${c.detail}\n`);
  }
  return reports.every((r) => r.ok) ? 0 : 1;
}

if (process.env['GAVEL_LOAD_RUN'] === '1') {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
      process.exit(1);
    },
  );
}
