import type { FakeFaultKind } from '../../src/fake/core.js';
import { createHoldFinder, processEvent, sweepOrphans } from '../../src/webhooks/orphans.js';
import { MemoryWebhookEventStore } from '../../src/stores/memory.js';
import type { HoldRecord, PaymentAudit, StoredWebhook } from '../../src/types.js';
import { prng } from '../helpers/crashHarness.js';
import {
  DAY_MS,
  HOUR_MS,
  MIN_MS,
  START_MS,
  STRICT_MODEL,
  World,
  auditWorld,
  type HoldRef,
  type LedgerSummary,
} from './world.js';

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export interface ScenarioResult {
  id: string;
  title: string;
  /** What was simulated, in simulated time. */
  timeline: string[];
  checks: Check[];
  stats: Array<[string, string]>;
}

class Recorder {
  readonly checks: Check[] = [];
  readonly timeline: string[] = [];
  readonly stats: Array<[string, string]> = [];

  check(name: string, ok: boolean, detail = ''): void {
    this.checks.push({ name, ok, detail });
  }

  note(w: World, text: string): void {
    this.timeline.push(`day ${w.day().toFixed(2)}: ${text}`);
  }

  stat(name: string, value: string | number): void {
    this.stats.push([name, String(value)]);
  }

  clean(l: LedgerSummary): void {
    this.check(
      'ledger balances to the cent, no double capture, no lost hold',
      l.problems.length === 0,
      l.problems.join('; '),
    );
  }

  result(id: string, title: string): ScenarioResult {
    return { id, title, timeline: this.timeline, checks: this.checks, stats: this.stats };
  }
}

const CEILINGS: Array<[string, number]> = [
  ['b1', 30000],
  ['b2', 25000],
  ['b3', 20000],
];
const CANDIDATES: Array<[string, number]> = [
  ['b1', 22000],
  ['b2', 21000],
  ['b3', 20000],
];
const AUCTION = 'lot1';

async function threeHolds(w: World, auctionId = AUCTION): Promise<HoldRef[]> {
  const out: HoldRef[] = [];
  for (const [bidder, cents] of CEILINGS) out.push(await w.openHold(auctionId, bidder, cents));
  return out;
}

function ref(holds: readonly HoldRef[], bidder: string): HoldRef {
  const h = holds.find((x) => x.bidderId === bidder);
  if (h === undefined) throw new Error(`no hold for ${bidder}`);
  return h;
}

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------- scenario 1

export async function scenario1(): Promise<ScenarioResult> {
  const r = new Recorder();
  const w = new World();
  const holds = await threeHolds(w);
  r.note(w, 'three buyers approve holds (ceilings $300, $250, $200)');
  w.atDay(1);
  await w.close(w.planFor(AUCTION, holds, CANDIDATES));
  r.note(w, 'auction closes, settlement starts');
  const s = await w.settle(AUCTION);
  r.note(w, `settlement ${s.status}`);
  r.check('settlement reaches SETTLED', s.status === 'settled' && s.journal?.state === 'SETTLED');
  r.check(
    'winner is b1, charged 22000 cents',
    s.journal?.winner?.bidderId === 'b1' && s.journal.winner.amountCents === 22000,
  );
  r.check('no reauthorization was needed', w.reauthCalls() === 0, `${w.reauthCalls()} calls`);
  const b1 = w.moneyOf(ref(holds, 'b1'));
  r.check(
    'b1 captured 22000 and the remainder was released',
    b1.capturedCents === 22000 && b1.openCents === 0,
  );
  r.check(
    'b2 and b3 fully released',
    ['b2', 'b3'].every((b) => {
      const m = w.moneyOf(ref(holds, b));
      return m.capturedCents === 0 && m.openCents === 0;
    }),
  );
  const ledger = await auditWorld(w, [AUCTION]);
  r.clean(ledger);
  r.stat('captured', dollars(ledger.capturedCents));
  return r.result('S1', 'Hold at day 0, capture at day 1');
}

// ---------------------------------------------------------------- scenario 2

export async function scenario2(): Promise<ScenarioResult> {
  const r = new Recorder();

  const w = new World();
  const holds = await threeHolds(w);
  w.atDay(2.5);
  await w.close(w.planFor(AUCTION, holds, CANDIDATES));
  r.note(
    w,
    'auction closes 2.5 days after the holds, inside the honor period and below the reauthorize threshold (2.75 days)',
  );
  const s = await w.settle(AUCTION);
  r.check(
    'settles with b1 as winner',
    s.status === 'settled' && s.journal?.winner?.bidderId === 'b1',
  );
  r.check(
    'capture happened before the honor period ended',
    w.moneyOf(ref(holds, 'b1')).capturedCents === 22000,
  );
  r.check('no reauthorization was attempted', w.reauthCalls() === 0, `${w.reauthCalls()} calls`);
  r.clean(await auditWorld(w, [AUCTION]));

  // The window between the policy threshold (2.75 days) and the end of the honor period (3 days).
  const w2 = new World();
  const holds2 = await threeHolds(w2);
  w2.atDay(2.9);
  await w2.close(w2.planFor(AUCTION, holds2, CANDIDATES));
  r.note(
    w2,
    'second run: auction closes at 2.9 days, past the threshold but still inside the honor period',
  );
  const s2 = await w2.settle(AUCTION);
  const refused = w2.audits.filter((a) => a.op === 'reauth' && a.label !== 'reauthorized').length;
  r.check(
    'a too-early reauthorization is refused and does not block the capture',
    s2.status === 'settled' && s2.journal?.winner?.bidderId === 'b1' && refused > 0,
    `${refused} refusals`,
  );
  r.clean(await auditWorld(w2, [AUCTION]));
  r.stat('too-early refusals at day 2.9', refused);
  return r.result('S2', 'Auction closes at day 2.5, capture before the honor period ends');
}

// ---------------------------------------------------------------- scenario 3

export async function scenario3(): Promise<ScenarioResult> {
  const r = new Recorder();

  // (a) reauthorization on, the production path for a multi-day auction.
  const w = new World();
  const holds = await threeHolds(w);
  w.atDay(3.5);
  await w.close(w.planFor(AUCTION, holds, CANDIDATES));
  r.note(w, 'auction closes 3.5 days after the holds, past the honor period; GAVEL_REAUTH on');
  const s = await w.settle(AUCTION);
  const b1 = ref(holds, 'b1');
  const chain = w.chainOf(b1);
  r.check(
    'settles with b1 as winner',
    s.status === 'settled' && s.journal?.winner?.bidderId === 'b1',
  );
  r.check(
    'every candidate hold was reauthorized once',
    w.reauthCalls() === 3,
    `${w.reauthCalls()} calls`,
  );
  r.check(
    'the journal moved to the new authorization and kept the old id',
    chain.length === 2 &&
      s.journal?.holds['b1']?.authId === chain[1] &&
      s.journal?.holds['b1']?.priorAuthIds?.[0] === chain[0],
  );
  r.check(
    'capture landed on the new authorization',
    w.core.inspect(chain[1] ?? '').capturedCents === 22000,
  );
  r.clean(await auditWorld(w, [AUCTION]));

  // (b) reauthorization off, strict reading of PayPal's rule.
  const off = new World({ reauth: false });
  const holdsOff = await threeHolds(off);
  off.atDay(3.5);
  await off.close(off.planFor(AUCTION, holdsOff, CANDIDATES));
  const sOff = await off.settle(AUCTION);
  r.note(
    off,
    `GAVEL_REAUTH off, strict model: settlement ${sOff.status} (${sOff.journal?.state ?? 'no journal'})`,
  );
  r.check(
    'without reauthorization nobody is charged (safe failure)',
    (await auditWorld(off, [AUCTION], { allowOpen: true })).capturedCents === 0,
  );
  r.check('the settlement is terminal, not stuck', sOff.status !== 'stuck');
  r.stat('GAVEL_REAUTH off, capture at day 3.5, strict model', sOff.journal?.state ?? 'none');

  // (c) reauthorization off, lenient reading (the fake's default).
  const lenient = new World({ reauth: false, model: { ...STRICT_MODEL, afterHonorCapture: 'ok' } });
  const holdsLen = await threeHolds(lenient);
  lenient.atDay(3.5);
  await lenient.close(lenient.planFor(AUCTION, holdsLen, CANDIDATES));
  const sLen = await lenient.settle(AUCTION);
  r.check(
    'lenient model: capture after the honor period still succeeds',
    sLen.status === 'settled' && sLen.journal?.winner?.bidderId === 'b1',
  );
  r.stat('GAVEL_REAUTH off, capture at day 3.5, lenient model', sLen.journal?.state ?? 'none');
  return r.result('S3', 'Capture at day 3.5, after the honor period, with reauthorization');
}

// ---------------------------------------------------------------- scenario 4

export async function scenario4(): Promise<ScenarioResult> {
  const r = new Recorder();
  const w = new World();
  const holds = await threeHolds(w);
  w.atDay(3.04);
  await w.close(w.planFor(AUCTION, holds, CANDIDATES));
  r.note(w, 'auction closes, the reauthorization pass runs and persists the new authorizations');
  const blocked = await w.reauthPass(AUCTION);
  const calls = w.reauthCalls();
  r.check(
    'reauthorized at day 3.04, one call per candidate',
    !blocked && calls === 3,
    `${calls} calls`,
  );
  w.atDay(5);
  r.note(w, 'the server was down; it comes back and runs the settlement');
  const s = await w.settle(AUCTION);
  const b1 = ref(holds, 'b1');
  r.check(
    'capture at day 5 succeeds on the reauthorized authorization',
    s.status === 'settled' &&
      s.journal?.winner?.bidderId === 'b1' &&
      w.moneyOf(b1).capturedCents === 22000,
  );
  r.check(
    'no second reauthorization was made',
    w.reauthCalls() === calls,
    `${w.reauthCalls()} calls`,
  );
  r.clean(await auditWorld(w, [AUCTION]));

  // Documented limit: the server reauthorizes each hold once. A capture more than a full
  // honor period after that reauthorization falls outside the strict model.
  const late = new World();
  const holdsLate = await threeHolds(late);
  late.atDay(3.04);
  await late.close(late.planFor(AUCTION, holdsLate, CANDIDATES));
  await late.reauthPass(AUCTION);
  late.atDay(6.5);
  const sLate = await late.settle(AUCTION);
  const ledgerLate = await auditWorld(late, [AUCTION], { allowOpen: true });
  r.note(
    late,
    `limit check: capture 3.46 days after the reauthorization, settlement ${sLate.status} (${sLate.journal?.state ?? 'none'})`,
  );
  r.check(
    'limit check: no money moves wrongly and the settlement is terminal',
    ledgerLate.problems.length === 0 && sLate.status !== 'stuck',
    ledgerLate.problems.join('; '),
  );
  r.stat(
    'capture at day 6.5 (second honor period, single reauthorization)',
    sLate.journal?.state ?? 'none',
  );
  return r.result('S4', 'Capture at day 5 after reauthorization at day 3');
}

// ---------------------------------------------------------------- scenario 5

export async function scenario5(): Promise<ScenarioResult> {
  const r = new Recorder();

  // Two holds placed at day 0 are never reauthorized and have expired by day 30;
  // the runner-up placed at day 28 is still valid.
  const w = new World();
  const old1 = await w.openHold(AUCTION, 'b1', 30000);
  const old2 = await w.openHold(AUCTION, 'b2', 25000);
  w.atDay(28);
  const fresh = await w.openHold(AUCTION, 'b3', 20000);
  r.note(w, 'b3 places a hold; b1 and b2 placed theirs at day 0 and nobody reauthorized them');
  w.atDay(30);
  await w.close(w.planFor(AUCTION, [old1, old2, fresh], CANDIDATES));
  r.note(w, 'auction closes at day 30, 30 days after the first holds (validity is 29 days)');
  const s = await w.settle(AUCTION);
  const failed = s.journal?.failed.map((f) => `${f.bidderId}:${f.reason}`).join(', ') ?? '';
  r.note(w, `settlement ${s.status}; failed candidates: ${failed}`);
  r.check(
    'b1 and b2 fail cleanly (definite failure, no capture)',
    (s.journal?.failed.length ?? 0) >= 2 &&
      w.moneyOf(old1).capturedCents === 0 &&
      w.moneyOf(old2).capturedCents === 0,
    failed,
  );
  r.check(
    'the runner-up b3 is charged its own planned price',
    s.status === 'settled' &&
      s.journal?.winner?.bidderId === 'b3' &&
      s.journal.winner.amountCents === 20000,
  );
  r.check(
    'the buyers who failed are released (expired holds return the funds)',
    w.moneyOf(old1).openCents === 0 && w.moneyOf(old2).openCents === 0,
  );
  r.clean(await auditWorld(w, [AUCTION]));
  r.stat('fallback path', failed);

  // Nobody has a live hold.
  const none = new World();
  const all = await threeHolds(none);
  none.atDay(30);
  await none.close(none.planFor(AUCTION, all, CANDIDATES));
  const sn = await none.settle(AUCTION);
  none.atDay(32);
  none.core.sweep();
  const ledgerNone = await auditWorld(none, [AUCTION]);
  r.note(
    none,
    `second run, all three holds expired: settlement ${sn.status} (${sn.journal?.state ?? 'none'})`,
  );
  r.check(
    'with no live hold nobody is charged and the settlement ends',
    ledgerNone.capturedCents === 0 && sn.status !== 'stuck',
    ledgerNone.problems.join('; '),
  );
  r.check(
    'every hold is released, none left open',
    ledgerNone.openCents === 0 && ledgerNone.problems.length === 0,
  );
  r.stat('all holds expired', sn.journal?.state ?? 'none');
  return r.result('S5', 'Hold never reauthorized, capture at day 30');
}

// ---------------------------------------------------------------- scenario 6

const CRASH_POINTS = [
  'journaled:begin',
  'journaled:intent',
  'before:capture',
  'after:capture',
  'journaled:capture_ok',
] as const;

export async function scenario6(): Promise<ScenarioResult> {
  const r = new Recorder();
  let restarts = 0;
  for (const label of CRASH_POINTS) {
    for (const forget of [false, true]) {
      const w = new World({ fileBacked: true });
      const holds = await threeHolds(w);
      w.atDay(2);
      await w.close(w.planFor(AUCTION, holds, CANDIDATES));
      const s = await w.settle(AUCTION, {
        crashOnce: [label],
        forgetIdempotency: forget,
        downMs: () => 6 * HOUR_MS,
      });
      restarts += s.crashes;
      const b1 = w.moneyOf(ref(holds, 'b1'));
      const ledger = await auditWorld(w, [AUCTION]);
      const ok =
        s.crashes === 1 &&
        s.status === 'settled' &&
        s.journal?.winner?.bidderId === 'b1' &&
        b1.capturedCents === 22000 &&
        ledger.problems.length === 0;
      r.check(
        `crash at ${label}${forget ? ' + idempotency table forgotten' : ''}: resumes from disk, one charge`,
        ok,
        `crashes=${s.crashes} status=${s.status} captured=${b1.capturedCents} ${ledger.problems.join('; ')}`,
      );
    }
  }
  r.timeline.push(
    'day 2.00: auction closes; the process is killed at one boundary, stays down 6 hours, restarts from the journal file',
  );
  r.stat('crash points x idempotency variants', CRASH_POINTS.length * 2);
  r.stat('restarts performed', restarts);
  return r.result('S6', 'Server crash and restart between hold and capture at day 2');
}

// ---------------------------------------------------------------- scenario 7

function webhook(id: string, authId: string, receivedAtMs: number): StoredWebhook {
  return {
    id,
    eventType: 'PAYMENT.AUTHORIZATION.VOIDED',
    receivedAtMs,
    body: JSON.stringify({
      id,
      event_type: 'PAYMENT.AUTHORIZATION.VOIDED',
      resource: { authId, reason: 'expired' },
    }),
  };
}

export async function scenario7(): Promise<ScenarioResult> {
  const r = new Recorder();
  const w = new World();
  const events = new MemoryWebhookEventStore();
  const deps = {
    gateway: w.gw,
    holds: w.holds,
    events,
    audit: { append: async () => undefined },
    clock: { nowMs: () => w.clock.nowMs() },
    findHold: createHoldFinder(w.holds, async () => [AUCTION]),
  };

  // A: a hold nobody used expires at day 29; PayPal's event reaches us at day 31.
  const a = await w.openHold(AUCTION, 'b1', 30000);
  // B: a hold that was reauthorized at day 3.5; the old authorization id is closed.
  const b = await w.openHold(AUCTION, 'b2', 25000);
  w.atDay(3.5);
  const re = await w.gw.reauthorize(b.authId, {
    amountCents: b.ceilingCents,
    requestId: 'req-reauth-b2',
  });
  const rec = await w.holds.get(b.holdId);
  if (rec === null) throw new Error('hold record missing');
  const moved: HoldRecord = { ...rec, authId: re.authId, priorAuthIds: [b.authId] };
  await w.holds.put(moved);
  r.note(w, 'b2 reauthorized; its record now points at the new authorization');
  w.atDay(29.5);
  w.core.sweep();
  const expiredEvents = w.core.events.filter(
    (e) => e.eventType === 'PAYMENT.AUTHORIZATION.VOIDED' && e.resource['reason'] === 'expired',
  );
  r.check(
    'the fake expires the unused hold at day 29 and emits the event',
    expiredEvents.length === 1,
    `${expiredEvents.length} events`,
  );

  w.atDay(31);
  const first = expiredEvents[0];
  if (first === undefined) throw new Error('no expiry event');
  const late = webhook(first.id, String(first.resource['authId']), w.clock.nowMs());
  await events.insertIfAbsent(late);
  const outcome = await processEvent(deps, late);
  r.note(w, `the expiry event for ${a.holdId} arrives 2 days late: ${outcome}`);
  r.check(
    'the late event marks the expired hold EXPIRED',
    outcome === 'applied' && (await w.holds.get(a.holdId))?.status === 'EXPIRED',
  );
  const dup = await events.insertIfAbsent(late);
  r.check('a duplicate delivery of the same event is dropped', dup === false);

  // The old, closed authorization of b2 is reported expired late (a delivery order we cannot rule out).
  const stale = webhook('WH-late-old-auth', b.authId, w.clock.nowMs());
  await events.insertIfAbsent(stale);
  const o2 = await processEvent(deps, stale);
  await sweepOrphans({ ...deps, events }, w.clock.nowMs() + DAY_MS);
  const after = await w.holds.get(b.holdId);
  r.note(w, `a late event for the old authorization of b2: ${o2}`);
  r.check(
    'a late event for a replaced authorization does not void the live hold',
    after?.status === 'HELD' && after.authId === re.authId,
    `status=${after?.status}`,
  );
  const live = w.core.getAuthorization(re.authId);
  r.check(
    'the reauthorized hold is still live at the fake',
    live.status === 'CREATED',
    live.status,
  );
  r.stat('events stored', Object.keys(events.snapshot().events).length);
  return r.result('S7', 'Webhook for an expired authorization arriving late');
}

// ---------------------------------------------------------------- scenario 8

const SOAK_DAYS = 30;
const SOAK_LOTS = 40;
const SOAK_BIDDERS = 100;

const CAPTURE_FAULTS: readonly FakeFaultKind[] = [
  'timeout_before',
  'timeout_after_success',
  'http_500',
  'http_429',
  'connection_reset',
  'capture_declined',
];
const VOID_FAULTS: readonly FakeFaultKind[] = [
  'timeout_before',
  'timeout_after_success',
  'http_500',
  'connection_reset',
];

interface Lot {
  id: string;
  closeAt: number;
  members: Array<{ bidder: string; joinAt: number; ceiling: number }>;
  /**
   * Every fifth lot: two injected 429s on its first capture, and a process restart at the capture
   * boundary followed by a 2-hour outage, which is past the 10-minute unknown deadline. The outage
   * is kept short on purpose: a multi-day one lapses the honor period of an in-doubt hold, and
   * that refusal is a separate cause, not a 429.
   */
  storm: boolean;
}

/** The cause of a lot that did not settle, read from PayPal's call log. */
const CAUSE_429 = 'rate limited (429)';
const CAUSE_OTHER = 'other (no PayPal failure, or a definite refusal)';

/**
 * An ambiguous capture or void (timeout, 5xx, lost answer) starts the unknown clock, so it is the
 * cause whenever one happened. A 429 starts no clock: a lot whose only PayPal failures are 429s
 * has no ambiguous cause, and a review among them would be the bug of issue 1937.
 */
function reviewCause(audits: readonly PaymentAudit[], auctionId: string): string {
  const calls = audits.filter((a) => a.auctionId === auctionId && a.kind === 'paypal_call');
  // A 429 is a stall, not a failure of the lot: it is left out until no other cause exists.
  const failed = calls.filter(
    (a) => a.label !== 'ok' && a.label !== 'rate_limited' && a.status !== 429,
  );
  const ambiguous = failed.find((a) => a.outcome === 'unknown');
  if (ambiguous !== undefined) {
    return `ambiguous ${ambiguous.op ?? 'call'} outcome (${ambiguous.label ?? 'error'})`;
  }
  const refused = failed.find((a) => a.outcome === 'definite');
  if (refused !== undefined) {
    return `definite refusal (${refused.label ?? 'error'}, ${refused.status ?? 0})`;
  }
  if (calls.some((a) => a.label === 'rate_limited' || a.status === 429)) return CAUSE_429;
  return CAUSE_OTHER;
}

export interface SoakNumbers {
  lots: number;
  settled: number;
  review: number;
  sold: number;
  unsold: number;
  fallbacks: number;
  crashes: number;
  outages: number;
  reauths: number;
  holds: number;
  faultsArmed: number;
  /** Lots that got the injected 429 storm. */
  storms: number;
  /** Storm lots that settled after at least one restart. */
  stormSurvived: number;
  /** Lots in review whose cause is a 429. Must be zero. */
  review429: number;
  /** Lots in review whose cause is an ambiguous capture or void. */
  reviewAmbiguous: number;
  /** Lots in review that began with a definite refusal (not a 429, not an ambiguous outcome). */
  reviewRefused: number;
}

export async function scenario8(
  seed = 20261107,
): Promise<ScenarioResult & { numbers: SoakNumbers }> {
  const r = new Recorder();
  const rand = prng(seed);
  const int = (lo: number, hi: number): number => lo + Math.floor(rand() * (hi - lo + 1));
  const w = new World();
  const bidders = Array.from(
    { length: SOAK_BIDDERS },
    (_, i) => `b${String(i + 1).padStart(3, '0')}`,
  );

  const lots: Lot[] = [];
  for (let i = 0; i < SOAK_LOTS; i += 1) {
    const start = rand() * (SOAK_DAYS - 7);
    const duration = 0.5 + rand() * 5.5;
    const pool = [...bidders];
    const members: Lot['members'] = [];
    const n = int(4, 10);
    for (let k = 0; k < n; k += 1) {
      const pick = int(0, pool.length - 1);
      const bidder = pool.splice(pick, 1)[0] as string;
      members.push({
        bidder,
        joinAt: start + rand() * duration * 0.9,
        ceiling: int(20, 200) * 500,
      });
    }
    lots.push({
      id: `soak${String(i + 1).padStart(2, '0')}`,
      closeAt: start + duration,
      members,
      storm: i % 5 === 0,
    });
  }

  type Ev = { at: number; order: number; run: () => Promise<void> };
  const events: Ev[] = [];
  const held = new Map<string, HoldRef[]>();
  const reviews: Array<[string, string]> = [];
  const causes = new Map<string, number>();
  const numbers: SoakNumbers = {
    lots: SOAK_LOTS,
    settled: 0,
    review: 0,
    sold: 0,
    unsold: 0,
    fallbacks: 0,
    crashes: 0,
    outages: 0,
    reauths: 0,
    holds: 0,
    faultsArmed: 0,
    storms: 0,
    stormSurvived: 0,
    review429: 0,
    reviewAmbiguous: 0,
    reviewRefused: 0,
  };

  for (const lot of lots) {
    held.set(lot.id, []);
    for (const m of lot.members) {
      events.push({
        at: m.joinAt,
        order: 0,
        run: async () => {
          held.get(lot.id)?.push(await w.openHold(lot.id, m.bidder, m.ceiling));
        },
      });
    }
    events.push({
      at: lot.closeAt,
      order: 1,
      run: async () => {
        const holds = held.get(lot.id) ?? [];
        const sorted = [...holds].sort(
          (x, y) => y.ceilingCents - x.ceilingCents || (x.bidderId < y.bidderId ? -1 : 1),
        );
        const candidates: Array<[string, number]> = [];
        let prev = Number.POSITIVE_INFINITY;
        for (const h of sorted) {
          const price = Math.min(h.ceilingCents - (candidates.length === 0 ? 500 : 0), prev);
          candidates.push([h.bidderId, price]);
          prev = price;
        }
        await w.close(w.planFor(lot.id, holds, candidates));
        const first = sorted[0];
        if (lot.storm) {
          // Two 429s on the first capture. They start no unknown clock, so the restart below
          // (2 hours down, past the unknown deadline) must not send the lot to review.
          if (first !== undefined) {
            w.core.inject('capture', 'http_429', first.authId, 2);
            numbers.faultsArmed += 1;
            numbers.storms += 1;
          }
        } else {
          if (first !== undefined && rand() < 0.12) {
            w.core.inject('capture', 'capture_declined', first.authId, 1);
            numbers.faultsArmed += 1;
          }
          if (rand() < 0.3) {
            const kind = CAPTURE_FAULTS[int(0, CAPTURE_FAULTS.length - 1)] as FakeFaultKind;
            w.core.inject('capture', kind, null, 1);
            numbers.faultsArmed += 1;
          }
          if (rand() < 0.2) {
            const kind = VOID_FAULTS[int(0, VOID_FAULTS.length - 1)] as FakeFaultKind;
            w.core.inject('void', kind, null, 1);
            numbers.faultsArmed += 1;
          }
        }
        const res = await w.settle(
          lot.id,
          lot.storm
            ? { rand, crashOnce: ['before:capture'], downMs: () => 2 * HOUR_MS }
            : {
                rand,
                crashProb: 0.03,
                forgetIdempotency: rand() < 0.25,
                downMs: (rnd) => {
                  const x = rnd();
                  if (x < 0.7) return int(2, 40) * MIN_MS;
                  if (x < 0.95) return int(1, 12) * HOUR_MS;
                  numbers.outages += 1;
                  return int(1, 4) * DAY_MS;
                },
              },
        );
        numbers.crashes += res.crashes;
        if (lot.storm && res.status === 'settled' && res.crashes >= 1) numbers.stormSurvived += 1;
        if (res.status !== 'settled') {
          const cause = reviewCause(w.audits, lot.id);
          causes.set(cause, (causes.get(cause) ?? 0) + 1);
          if (cause === CAUSE_429) numbers.review429 += 1;
          if (cause.startsWith('ambiguous')) numbers.reviewAmbiguous += 1;
          if (cause.startsWith('definite refusal')) numbers.reviewRefused += 1;
          const last = res.journal?.history[res.journal.history.length - 1]?.label ?? 'none';
          const reauthed = Object.values(res.journal?.holds ?? {}).filter(
            (h) => (h.priorAuthIds?.length ?? 0) > 0,
          ).length;
          const failedWhy =
            res.journal?.failed.map((f) => `${f.bidderId}:${f.reason}`).join(',') ?? '';
          const tail = w.audits
            .filter((a) => a.auctionId === lot.id && a.kind === 'paypal_call')
            .slice(-8)
            .map(
              (a) =>
                `${a.op ?? ''}/${a.label ?? ''}/${a.outcome ?? ''}/${a.status ?? ''}@${((a.tsMs - START_MS) / DAY_MS).toFixed(3)}`,
            )
            .join(' ');
          reviews.push([
            lot.id,
            `cause ${cause}; closed day ${lot.closeAt.toFixed(2)}, down ${(res.downMs / DAY_MS).toFixed(2)} days, last step ${last}, reauthorized holds ${reauthed}, failed ${failedWhy}, passes ${res.passes}, crashes ${res.crashes}, last calls ${tail}`,
          ]);
        }
        if (res.status === 'settled') numbers.settled += 1;
        else numbers.review += 1;
        if (res.journal !== null && res.journal.winner !== null) numbers.sold += 1;
        else numbers.unsold += 1;
        if ((res.journal?.failed.length ?? 0) > 0) numbers.fallbacks += 1;
      },
    });
  }
  events.sort((x, y) => x.at - y.at || x.order - y.order);
  for (const ev of events) {
    w.atDay(ev.at);
    await ev.run();
  }
  r.timeline.push(
    `day 0 to ${SOAK_DAYS}: ${SOAK_LOTS} lots, ${SOAK_BIDDERS} bidders, 3% crash chance at every boundary, outages of 1 to 4 days in 5% of crashes, random PayPal faults; every fifth lot (${numbers.storms} lots) gets two injected 429s on its first capture and a restart after a 2-hour outage, past the unknown deadline`,
  );
  r.timeline.push(
    `the 429 bug is fixed (https://github.com/harshbhx/gavel-auction/issues/1937, PR https://github.com/harshbhx/gavel-auction/pull/1938): a 429 starts no unknown clock, and ${numbers.review429} lots in this run reached review because of one. A timeout, a 5xx or a lost answer followed by an outage longer than the unknown deadline still reaches review by design: ${numbers.reviewAmbiguous} of the ${numbers.review} lots in review began that way. ${numbers.reviewRefused} lots began with a definite refusal (not a 429 and not an ambiguous outcome): PayPal refused the capture and the saga, which does not classify that refusal, keeps the lot under the unknown deadline. The cause of each lot in review is listed in the measures.`,
  );

  // Everything left open must be released by PayPal's own expiry within the validity period.
  w.atDay(SOAK_DAYS + 60);
  w.core.sweep();
  numbers.reauths = w.reauthCalls();
  numbers.holds = w.roots.length;
  const ids = lots.map((l) => l.id);
  const ledger = await auditWorld(w, ids);

  r.check(
    'every lot ends terminal',
    numbers.settled + numbers.review === SOAK_LOTS,
    `${numbers.settled} settled, ${numbers.review} in review`,
  );
  r.check(
    'no lot ends in FAILED_NEEDS_REVIEW because of a 429',
    numbers.review429 === 0,
    `${numbers.review429} of ${numbers.review} lots in review have a 429 as their cause`,
  );
  r.check(
    'injected 429s on capture are survived across a restart past the unknown deadline',
    numbers.storms > 0 && numbers.stormSurvived > 0,
    `${numbers.stormSurvived} of ${numbers.storms} storm lots settled after a restart`,
  );
  r.check(
    'no double capture',
    !ledger.problems.some(
      (p) =>
        p.includes('captures on one hold') ||
        p.includes('buyers were charged') ||
        p.includes('fake invariant'),
    ),
    ledger.problems.join('; '),
  );
  r.check(
    'no lost hold: every hold is captured or released',
    !ledger.problems.some((p) => p.includes('never released')),
    ledger.problems.join('; '),
  );
  r.check(
    'ledger balances to the cent',
    ledger.heldCents === ledger.capturedCents + ledger.releasedCents + ledger.openCents &&
      ledger.capturedCents === ledger.winnersCents,
    `held ${ledger.heldCents} captured ${ledger.capturedCents} released ${ledger.releasedCents} open ${ledger.openCents} won ${ledger.winnersCents}`,
  );
  r.check('no other violation', ledger.problems.length === 0, ledger.problems.join('; '));
  r.stat('lots settled / in review', `${numbers.settled} / ${numbers.review}`);
  r.stat('lots sold / unsold', `${numbers.sold} / ${numbers.unsold}`);
  r.stat('lots that used the runner-up fallback', numbers.fallbacks);
  r.stat('holds', numbers.holds);
  r.stat('reauthorize calls', numbers.reauths);
  r.stat('process crashes survived', numbers.crashes);
  r.stat('multi-day outages', numbers.outages);
  r.stat('PayPal faults armed', numbers.faultsArmed);
  r.stat('held in total', dollars(ledger.heldCents));
  r.stat('captured', dollars(ledger.capturedCents));
  r.stat('released', dollars(ledger.releasedCents));
  r.stat('still open', dollars(ledger.openCents));
  r.stat('lots in review because of a 429', numbers.review429);
  for (const cause of [...causes.keys()].sort()) {
    r.stat(`lots in review, cause: ${cause}`, causes.get(cause) ?? 0);
  }
  r.stat('429 storm lots (injected)', numbers.storms);
  r.stat('429 storm lots settled after a restart', numbers.stormSurvived);
  for (const [lotId, why] of reviews) r.stat(`lot in review: ${lotId}`, why);
  r.stat('seed', seed);
  return { ...r.result('S8', '30 simulated days, 100 bidders, random crashes'), numbers };
}

export const ALL_SCENARIOS: Array<() => Promise<ScenarioResult>> = [
  scenario1,
  scenario2,
  scenario3,
  scenario4,
  scenario5,
  scenario6,
  scenario7,
  scenario8,
];
