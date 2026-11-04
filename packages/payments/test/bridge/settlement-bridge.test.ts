import {
  AuctionRuntime,
  InMemoryLedgerStore,
  parseCommand,
  type AuctionState,
  type LedgerEntry,
} from '@gavel/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { runSettlementTail } from './tail.js';
import { createEngineAdapter } from '../../src/bridge/adapter.js';
import {
  SettlementBridge,
  revokeReasonFor,
  settlementRef,
} from '../../src/bridge/settlement-bridge.js';
import { FakeClock, FakePayPalCore } from '../../src/fake/core.js';
import { FakeGateway } from '../../src/fake/gateway.js';
import { runCapturePhase } from '../../src/saga/capture.js';
import { createSettlement, newJournal } from '../../src/saga/create.js';
import { step } from '../../src/saga/machine.js';
import { planFromOutcome, type PlanOutcome } from '../../src/saga/plan.js';
import { MemoryJournalStore } from '../../src/stores/memory.js';
import type { HoldRecord, HoldRef, Journal, PaymentAudit } from '../../src/types.js';
import { FRESH_HOLDS, freshJournal } from '../helpers/age.js';

const START_MS = 1_800_000_000_000;
const pad = (s: string): string => s.padStart(26, '0');
const AU = pad('AAA');
const LOT = pad('M1');
const A = pad('BA');
const B = pad('BB');
const C = pad('BC');

interface Rig {
  runtime: AuctionRuntime;
  store: InMemoryLedgerStore;
  bridge: SettlementBridge;
  core: FakePayPalCore;
  clock: FakeClock;
  journals: MemoryJournalStore;
  holds: Record<string, HoldRef>;
  audits: PaymentAudit[];
}

let counter = 0;
const nextId = (): string => pad(`C${(counter += 1).toString(16).toUpperCase()}X`);

async function makeRig(hasHold: readonly string[]): Promise<Rig> {
  const store = new InMemoryLedgerStore();
  const runtime = new AuctionRuntime({ store });
  const send = async (at: number, body: Record<string, unknown>): Promise<void> => {
    await runtime.dispatch(parseCommand({ commandId: nextId(), at, auctionId: AU, ...body }));
  };
  await send(0, { type: 'CreateAuction', title: 'Gala', config: {} });
  await send(0, {
    type: 'AddLot',
    lot: {
      lotId: LOT,
      title: 'Vase',
      mode: 'english',
      reserveCents: 10000,
      increment: { flatCents: 100 },
      durationMs: 10000,
      softClose: { windowMs: 0, extensionMs: 0, maxExtensions: 3 },
      hammer: 'auto',
    },
  });
  for (const bidderId of [A, B, C]) {
    await send(0, { type: 'RegisterBidder', bidderId, ceilingCents: 30000 });
  }
  await send(100, { type: 'OpenLot', lotId: LOT });
  const bids: Array<[string, number]> = [
    [C, 20000],
    [B, 21000],
    [A, 22000],
  ];
  for (const [i, [bidderId, amountCents]] of bids.entries()) {
    await send(200 + i * 10, {
      type: 'PlaceBid',
      lotId: LOT,
      bidderId,
      amountCents,
      source: 'manual',
      audit: {},
    });
  }
  await send(300, { type: 'Hammer', lotId: LOT, actor: 'host', early: true });

  const clock = new FakeClock(START_MS);
  const core = new FakePayPalCore({ clock });
  const holds: Record<string, HoldRef> = {};
  for (const bidderId of hasHold) {
    holds[bidderId] = {
      holdId: `hold-${bidderId}`,
      authId: core.createAuthorization(`payer-${bidderId}`, 30000).id,
      ceilingCents: 30000,
      createdAtMs: START_MS,
    };
  }
  const engine = createEngineAdapter({
    dispatch: async (cmd) => void (await runtime.dispatch(parseCommand(cmd))),
    state: (id) => runtime.state(id as never) as Promise<AuctionState>,
    read: (id, from) => store.read(id as never, from),
    newCommandId: nextId,
    nowMs: () => 400,
  });
  return {
    runtime,
    store,
    bridge: new SettlementBridge(engine),
    core,
    clock,
    journals: new MemoryJournalStore(),
    holds,
    audits: [],
  };
}

async function outcomeOf(rig: Rig): Promise<PlanOutcome> {
  const entries = await rig.store.read(AU as never, 1);
  const hammer = entries.find((e: LedgerEntry) => e.type === 'LOT_HAMMERED');
  if (hammer === undefined || hammer.type !== 'LOT_HAMMERED') throw new Error('not hammered');
  return hammer.payload;
}

async function lotOf(rig: Rig): Promise<AuctionState['lots'][string]> {
  const lot = (await rig.runtime.state(AU as never)).lots[LOT];
  if (lot === undefined) throw new Error('no lot');
  return lot;
}

function capture(rig: Rig): ReturnType<typeof runCapturePhase> {
  return runCapturePhase(
    {
      journals: rig.journals,
      gateway: new FakeGateway(rig.core),
      audit: { append: async (e) => void rig.audits.push(e) },
      clock: { nowMs: () => rig.clock.nowMs() },
    },
    LOT,
  );
}

describe('SettlementBridge', () => {
  let rig: Rig;

  describe('winner without a hold (INTEGRATION-R2-01)', () => {
    beforeEach(async () => {
      rig = await makeRig([B, C]);
    });

    it('promotes past the skipped winner so the engine and the saga agree', async () => {
      const outcome = await outcomeOf(rig);
      expect(outcome.winnerId).toBe(A);
      const prepared = await rig.bridge.prepare(AU, outcome, rig.holds, 10000);
      expect(prepared.status).toBe('ready');
      expect(prepared.promoted.map((p) => p.bidderId)).toEqual([A]);
      expect((await lotOf(rig)).winnerId).toBe(B);

      await createSettlement({ journals: rig.journals, ...FRESH_HOLDS }, prepared.plan);
      const out = await capture(rig);
      expect(out.status).toBe('captured');
      if (out.status !== 'captured') return;
      expect(out.journal.winner?.bidderId).toBe(B);
    });

    it('runs hammer, plan, saga, record, complete and close through the runtime', async () => {
      const prepared = await rig.bridge.prepare(AU, await outcomeOf(rig), rig.holds, 10000);
      await createSettlement({ journals: rig.journals, ...FRESH_HOLDS }, prepared.plan);
      await capture(rig);

      const journal = await runSettlementTail(rig);

      const fin = await rig.bridge.finish(AU, journal);
      expect(fin).toEqual({ status: 'completed', bidderId: B, capturedCents: 21000 });
      const lot = await lotOf(rig);
      expect(lot.status).toBe('DONE');
      expect(lot.winnerId).toBe(B);
      expect(lot.capturedCents).toBe(21000);
      expect(lot.settlement).toBe('SETTLED');

      expect(await rig.bridge.closeIfDone(AU)).toEqual({ status: 'closed' });
      expect((await rig.runtime.state(AU as never)).closed).toBe(true);
    });

    it('is safe to repeat: a second pass sends nothing new', async () => {
      const prepared = await rig.bridge.prepare(AU, await outcomeOf(rig), rig.holds, 10000);
      await createSettlement({ journals: rig.journals, ...FRESH_HOLDS }, prepared.plan);
      await capture(rig);

      const journal = await runSettlementTail(rig);
      await rig.bridge.finish(AU, journal);
      const head = await rig.store.head(AU as never);
      expect(await rig.bridge.recordProgress(AU, journal)).toBe(0);
      await rig.bridge.finish(AU, journal);
      expect(await rig.store.head(AU as never)).toEqual(head);
    });

    it('refuses to book a capture to a bidder who is not the engine winner', async () => {
      const outcome = await outcomeOf(rig);
      // The engine was never told to skip A, but the saga charges B.
      const plan = planFromOutcome(outcome, rig.holds, 10000);
      let j = freshJournal(plan);
      j = step(j, { type: 'start_auction', tsMs: 1 }).journal;
      j = step(j, { type: 'hammer', tsMs: 2 }).journal;
      j = step(j, { type: 'begin', tsMs: 3 }).journal;
      j = step(j, {
        type: 'capture_ok',
        tsMs: 4,
        winner: {
          bidderId: B,
          holdId: rig.holds[B]?.holdId ?? '',
          captureId: 'CAP',
          amountCents: 21000,
        },
      }).journal;
      j = step(j, { type: 'begin_void', tsMs: 5 }).journal;
      j = step(j, { type: 'all_released', tsMs: 6 }).journal;
      await expect(rig.bridge.finish(AU, j)).rejects.toMatchObject({
        name: 'BridgeError',
        code: 'winner_mismatch',
      });
    });
  });

  describe('capture declined, runner-up charged (PAYMENTS-R3-01)', () => {
    function fallbackJournal(
      plan: Parameters<typeof newJournal>[0],
      holds: Record<string, HoldRef>,
    ): Journal {
      let j = freshJournal(plan);
      j = step(j, { type: 'start_auction', tsMs: 1 }).journal;
      j = step(j, { type: 'hammer', tsMs: 2 }).journal;
      j = step(j, { type: 'begin', tsMs: 3 }).journal;
      j = step(j, {
        type: 'definite_fail',
        tsMs: 4,
        failure: { bidderId: A, reason: 'capture_declined' },
      }).journal;
      j = step(j, { type: 'next_candidate', tsMs: 5 }).journal;
      j = step(j, {
        type: 'capture_ok',
        tsMs: 6,
        winner: {
          bidderId: B,
          holdId: holds[B]?.holdId ?? '',
          captureId: 'CAPB',
          amountCents: 21000,
        },
      }).journal;
      j = step(j, { type: 'begin_void', tsMs: 7 }).journal;
      return step(j, { type: 'all_released', tsMs: 8 }).journal;
    }

    it('promotes the engine to the charged runner-up, completes the lot and closes', async () => {
      rig = await makeRig([A, B, C]);
      const { plan } = await rig.bridge.prepare(AU, await outcomeOf(rig), rig.holds, 10000);
      const j = fallbackJournal(plan, rig.holds);
      expect((await lotOf(rig)).winnerId).toBe(A);

      expect(await rig.bridge.finish(AU, j)).toEqual({
        status: 'completed',
        bidderId: B,
        capturedCents: 21000,
      });
      const lot = await lotOf(rig);
      expect(lot.status).toBe('DONE');
      expect(lot.winnerId).toBe(B);
      expect(lot.capturedCents).toBe(21000);
      expect(await rig.bridge.closeIfDone(AU)).toEqual({ status: 'closed' });
    });

    it('resumes after a crash that happened between the promote and CompleteLot', async () => {
      rig = await makeRig([A, B, C]);
      const { plan } = await rig.bridge.prepare(AU, await outcomeOf(rig), rig.holds, 10000);
      const j = fallbackJournal(plan, rig.holds);
      await rig.bridge.recordProgress(AU, j);
      await rig.runtime.dispatch(
        parseCommand({
          commandId: nextId(),
          at: 400,
          auctionId: AU,
          type: 'PromoteRunnerUp',
          lotId: LOT,
          disqualifiedBidderId: A,
          reason: 'capture_declined',
        }),
      );
      expect((await lotOf(rig)).winnerId).toBe(B);

      expect(await rig.bridge.finish(AU, j)).toMatchObject({ status: 'completed', bidderId: B });
      const head = await rig.store.head(AU as never);
      expect(await rig.bridge.finish(AU, j)).toMatchObject({ status: 'completed', bidderId: B });
      expect(await rig.store.head(AU as never)).toEqual(head);
    });
  });

  describe('nobody can be charged', () => {
    it('marks the lot unsold and still closes the auction', async () => {
      rig = await makeRig([]);
      const prepared = await rig.bridge.prepare(AU, await outcomeOf(rig), rig.holds, 10000);
      expect(prepared.status).toBe('unsold');
      expect((await lotOf(rig)).status).toBe('DONE');
      expect(await rig.bridge.closeIfDone(AU)).toEqual({ status: 'closed' });
    });

    it('turns the lot unsold when the saga ends settled with no charge', async () => {
      rig = await makeRig([A, B, C]);
      const { plan } = await rig.bridge.prepare(AU, await outcomeOf(rig), rig.holds, 10000);
      let j = freshJournal({ ...plan, candidates: [] });
      j = step(j, { type: 'start_auction', tsMs: 1 }).journal;
      j = step(j, { type: 'hammer', tsMs: 2 }).journal;
      j = step(j, { type: 'no_candidate', tsMs: 3 }).journal;
      j = step(j, { type: 'all_released', tsMs: 4 }).journal;
      expect(await rig.bridge.finish(AU, j)).toEqual({ status: 'unsold' });
      expect((await lotOf(rig)).status).toBe('DONE');
      expect((await lotOf(rig)).settlement).toBe('SETTLED');
    });

    it('records the release for a lot the engine already ended unsold (ENG-R3-01)', async () => {
      rig = await makeRig([]);
      const { plan } = await rig.bridge.prepare(AU, await outcomeOf(rig), rig.holds, 10000);
      expect((await lotOf(rig)).settlement).toBe('VOIDING');
      let j = freshJournal({ ...plan, candidates: [] });
      j = step(j, { type: 'start_auction', tsMs: 1 }).journal;
      j = step(j, { type: 'hammer', tsMs: 2 }).journal;
      j = step(j, { type: 'no_candidate', tsMs: 3 }).journal;
      j = step(j, { type: 'all_released', tsMs: 4 }).journal;
      expect(await rig.bridge.finish(AU, j)).toEqual({ status: 'unsold' });
      expect((await lotOf(rig)).settlement).toBe('SETTLED');
      expect(await rig.bridge.finish(AU, j)).toEqual({ status: 'unsold' });
    });
  });

  describe('a settlement that needs review', () => {
    it('records the history but leaves the lot SETTLING and the auction open', async () => {
      rig = await makeRig([A, B, C]);
      const { plan } = await rig.bridge.prepare(AU, await outcomeOf(rig), rig.holds, 10000);
      let j = freshJournal(plan);
      j = step(j, { type: 'start_auction', tsMs: 1 }).journal;
      j = step(j, { type: 'hammer', tsMs: 2 }).journal;
      j = step(j, { type: 'invariant', tsMs: 3 }).journal;
      expect(await rig.bridge.finish(AU, j)).toEqual({ status: 'needs_review' });
      const lot = await lotOf(rig);
      expect(lot.status).toBe('SETTLING');
      expect(lot.settlement).toBe('FAILED_NEEDS_REVIEW');
      expect(await rig.bridge.closeIfDone(AU)).toEqual({ status: 'open_lots', lotIds: [LOT] });
      expect(settlementRef(LOT, 1)).toBe(`saga:${LOT}:1`);
    });
  });

  describe('holds that fail', () => {
    const hold = (status: HoldRecord['status']): HoldRecord => ({
      holdId: 'h',
      auctionId: AU,
      bidderId: B,
      orderId: 'o',
      ceilingCents: 30000,
      status,
      createdAtMs: 0,
    });

    it('maps a declined, expired or voided hold to RevokeCeiling', async () => {
      rig = await makeRig([A, B, C]);
      expect(revokeReasonFor('DENIED')).toBe('declined');
      expect(revokeReasonFor('HELD')).toBeNull();
      expect(await rig.bridge.onHoldStatus(AU, hold('HELD'))).toBe(false);
      expect(await rig.bridge.onHoldStatus(AU, hold('EXPIRED'))).toBe(true);
      const state = await rig.runtime.state(AU as never);
      expect(Object.values(state.bidders).find((b) => b.bidderId === B)?.revoked).toBe(true);
      // A repeat is a no-op in the engine, not an error.
      expect(await rig.bridge.onHoldStatus(AU, hold('EXPIRED'))).toBe(true);
    });
  });
});
