import {
  HoldService,
  MemoryHoldStore,
  MemoryJournalStore,
  PayPalGateway,
  TokenManager,
  Transport,
  createSettlement,
  runSettlement,
  type PaymentAudit,
  type SettlementPlan,
} from '@gavel/payments';
import { FakePayPalServer } from '@gavel/payments/fake';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { voidSpareHolds, type SpareVoidDeps } from '../../src/runtime/void-phase';

// TST-12 (issue 2410, gap 5): settlement schedules that carry a spare or a superseded (raised)
// hold. The payments saga rig (test/saga/rig.ts) lives in another package and cannot reach
// `voidSpareHolds`, which is the server's spare release, so this is a table-driven scenario test:
// 80 generated schedules through the real HoldService, the real settlement saga and the real
// spare release on the fake PayPal. Not a fast-check property: the schedules come from a fixed
// seeded generator so a failure names its case number.
//
// Per schedule: only the winning price is captured, every other authorization is voided exactly
// once (a repeat of the spare release does nothing), and captured cents add up to the price.

const noSleep = async (): Promise<void> => undefined;
const noAudit = { append: async (): Promise<void> => undefined };
const CASES = 80;
const RESERVE = 1000;

function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Shape =
  | 'single' // one hold, registered
  | 'raised' // a raise hold is registered; the superseded first hold stays HELD
  | 'raise_unswitched' // the first hold is registered; an approved raise hold never reached the room
  | 'stranger'; // a HELD hold of a bidder that never registered

const SHAPES: Shape[] = ['single', 'raised', 'raise_unswitched', 'stranger'];

let paypal: FakePayPalServer;
let gateway: PayPalGateway;
let holdsApi: HoldService;
let holds: MemoryHoldStore;
const audits: PaymentAudit[] = [];
let holdCounter = 0;
const clock = { nowMs: (): number => 1_800_000_000_000 };

beforeAll(async () => {
  paypal = new FakePayPalServer({ timers: { sleep: noSleep } });
  await paypal.start();
  const auth = new TokenManager({
    transport: new Transport({ sleep: noSleep }),
    baseUrl: paypal.url,
    clientId: 'fake-client',
    clientSecret: 'fake-secret-value',
  });
  gateway = new PayPalGateway({ auth, fake: true, clock });
  holds = new MemoryHoldStore();
  holdsApi = new HoldService({
    gateway,
    holds,
    audit: { append: async (e) => void audits.push(e) },
    clock,
    maxCeilingCents: 100_000,
    newId: () => `HOLD-${(holdCounter += 1)}`,
  });
});

afterAll(async () => {
  await paypal.stop();
});

/** Creates and approves one hold; returns its record's ids. */
async function approvedHold(auctionId: string, bidderId: string, ceilingCents: number) {
  const created = await holdsApi.createHoldOrder({
    auctionId,
    bidderId,
    ceilingCents,
    presetsCents: [ceilingCents],
  });
  paypal.core.approveOrder(created.orderId);
  await holdsApi.completeApproval({ holdId: created.holdId, orderId: created.orderId });
  const rec = await holds.get(created.holdId);
  if (rec?.status !== 'HELD' || rec.authId === undefined) throw new Error('hold not HELD');
  return { holdId: created.holdId, orderId: created.orderId, authId: rec.authId, ceilingCents };
}

describe('settlement schedules with spare and superseded holds', () => {
  it(`captures only the winning price and voids every other hold once, over ${CASES} schedules`, async () => {
    for (let n = 1; n <= CASES; n += 1) {
      const rand = prng(n * 7919);
      const int = (lo: number, hi: number): number => lo + Math.floor(rand() * (hi - lo + 1));
      const auctionId = `sched-${n}`;
      const label = `case ${n}`;
      const bidderCount = int(2, 5);

      interface Bidder {
        id: string;
        shape: Shape;
        registered?: Awaited<ReturnType<typeof approvedHold>>;
        all: Array<Awaited<ReturnType<typeof approvedHold>>>;
      }
      const bidders: Bidder[] = [];
      for (let b = 0; b < bidderCount; b += 1) {
        const shape = (b === 0 ? 'single' : SHAPES[int(0, SHAPES.length - 1)]) as Shape;
        const id = `${auctionId}-b${b}`;
        const first = await approvedHold(auctionId, id, int(50, 300) * 100);
        const entry: Bidder = { id, shape, all: [first] };
        if (shape === 'raised' || shape === 'raise_unswitched') {
          const raise = await approvedHold(
            auctionId,
            id,
            first.ceilingCents +
              Math.ceil((first.ceilingCents * 0.06) / 100) * 100 +
              int(0, 40) * 100,
          );
          expect(raise.holdId, label).not.toBe(first.holdId);
          entry.all.push(raise);
          entry.registered = shape === 'raised' ? raise : first;
        } else if (shape === 'single') {
          entry.registered = first;
        }
        bidders.push(entry);
      }

      const planned = bidders.filter((b) => b.registered !== undefined);
      // Prices step down from the lowest registered ceiling, so every candidate fits its hold.
      const top = Math.min(...planned.map((b) => b.registered?.ceilingCents ?? 0));
      const order = [...planned].sort(() => rand() - 0.5);
      const candidates = order.map((b, i) => ({ bidderId: b.id, priceCents: top - 100 * i }));
      expect(
        candidates.every((c) => c.priceCents >= RESERVE),
        label,
      ).toBe(true);
      const planHolds: SettlementPlan['holds'] = {};
      for (const b of planned) {
        const r = b.registered;
        if (r === undefined) continue;
        planHolds[b.id] = {
          holdId: r.holdId,
          authId: r.authId,
          ceilingCents: r.ceilingCents,
          createdAtMs: clock.nowMs(),
          orderId: r.orderId,
        };
      }
      const plan: SettlementPlan = {
        auctionId,
        reserveCents: RESERVE,
        candidates,
        holds: planHolds,
      };
      const journals = new MemoryJournalStore();
      await createSettlement({ journals, clock, holdMaxAgeMs: 7_200_000, audit: noAudit }, plan);
      const keep = new Set(Object.values(planHolds).map((h) => h.holdId));
      const spareDeps: SpareVoidDeps = { audit: noAudit, clock, gateway, holds };
      const deps = { journals, gateway, audit: noAudit, clock };

      // The order the service uses: spares before the capture, the saga, spares after.
      await voidSpareHolds(spareDeps, { auctionId }, keep);
      const out = await runSettlement(deps, auctionId);
      expect(out.status, label).toBe('settled');
      expect(await voidSpareHolds(spareDeps, { auctionId }, keep), label).toBe(0);
      expect(await voidSpareHolds(spareDeps, { auctionId }, keep), label).toBe(0);

      const winner = candidates[0];
      if (winner === undefined) throw new Error('a winner is planned');
      const winnerAuth = planHolds[winner.bidderId]?.authId ?? '';
      let capturedTotal = 0;
      for (const b of bidders) {
        for (const h of b.all) {
          const seen = paypal.core.inspect(h.authId);
          expect(Number.isInteger(seen.capturedCents), label).toBe(true);
          capturedTotal += seen.capturedCents;
          if (h.authId === winnerAuth) {
            expect(seen.capturedCents, `${label} winner`).toBe(winner.priceCents);
            continue;
          }
          // Everything else: nothing captured, voided once, never twice.
          expect(seen.capturedCents, `${label} ${b.shape} ${h.holdId} captured`).toBe(0);
          expect(seen.voidEffects, `${label} ${b.shape} ${h.holdId} void effects`).toBe(1);
          expect(paypal.core.getAuthorization(h.authId).status, label).toBe('VOIDED');
        }
      }
      expect(capturedTotal, `${label} captured total`).toBe(winner.priceCents);
    }
  }, 180_000);
});
