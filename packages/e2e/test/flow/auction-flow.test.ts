import { evolveAll, exportJsonl, tamperAt, verifyJsonl } from '@gavel/engine';
import type { HoldRecord, Journal } from '@gavel/payments';
import { parseUtterance } from '@gavel/voice';
import type { AuctionId } from '@gavel/shared';
import type { AuctionService } from '@gavel/server';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CONFIG,
  bidMessage,
  connect,
  enroll,
  ledgerKey,
  makeRig,
  type Bidder,
  type Rig,
} from './rig';

/** Auction flow in one process: engine, room, settlement saga and the fake PayPal server. */

const open: Array<{ stop(): Promise<void> }> = [];

afterEach(async () => {
  for (const p of open.splice(0)) await p.stop();
});

async function newRig(): Promise<Rig> {
  const rig = await makeRig();
  open.push(rig.paypal);
  return rig;
}

interface Run {
  auctionId: AuctionId;
  ana: Bidder;
  ben: Bidder;
  cy: Bidder;
}

const WINNING_PRICE = 25000;

/**
 * Ana (ceiling 500.00), Ben and Cy (ceiling 300.00) register with holds and bid. Two bids come
 * from the voice parser, the rest are manual. Ana leads at 250.00 and the auctioneer hammers.
 */
async function runToHammer(rig: Rig, service: AuctionService): Promise<Run> {
  const auctionId = rig.ids.mint<'AuctionId'>();
  const room = await service.createAuction(auctionId, CONFIG, 'auctioneer-sub');
  const ana = await enroll(rig, service, room, auctionId, 'Ana', 50000);
  const ben = await enroll(rig, service, room, auctionId, 'Ben', 30000);
  const cy = await enroll(rig, service, room, auctionId, 'Cy', 30000);
  await connect(rig, room, 'screen');
  const boss = await connect(rig, room, 'auctioneer');

  const paddles = new Map<string, Bidder>([
    ['9', ana],
    ['7', ben],
  ]);
  const spoken = async (text: string, price: number): Promise<void> => {
    const parsed = parseUtterance(text, { currentPriceCents: price, minIncrementCents: 500 });
    expect(parsed.status).toBe('bid');
    const who = parsed.bidder === null ? undefined : paddles.get(parsed.bidder.value);
    if (who === undefined || parsed.amountCents === null) throw new Error(`no bid in "${text}"`);
    await room.submitBid(who.conn, bidMessage(rig, parsed.amountCents, 'voice'));
  };

  await room.submitBid(ana.conn, bidMessage(rig, 10000, 'manual'));
  await spoken('one fifty for paddle seven', 10000);
  await room.submitBid(ana.conn, bidMessage(rig, 20000, 'manual'));
  await room.submitBid(cy.conn, bidMessage(rig, 22500, 'manual'));
  await spoken('two hundred fifty for paddle nine', 22500);
  await room.control(boss.conn, { controlId: 'hammer-1', action: 'hammer', args: { closeNow: 1 } });
  return { auctionId, ana, ben, cy };
}

/** The end state of a settled auction, however often the process died on the way. */
async function expectSettled(rig: Rig, run: Run): Promise<void> {
  const { core } = rig.paypal;
  const won = core.getAuthorization(run.ana.authId);
  expect(won.captures).toHaveLength(1);
  expect(won.captures[0]).toMatchObject({ amountCents: WINNING_PRICE, final: true });
  expect(won.capturedCents).toBe(WINNING_PRICE);
  for (const l of [run.ben, run.cy]) {
    const auth = core.getAuthorization(l.authId);
    expect(auth.status).toBe('VOIDED');
    expect(auth.captures).toHaveLength(0);
  }
  core.checkInvariants();

  const journal: Journal | null = await rig.stores.journals.load(run.auctionId);
  expect(journal?.state).toBe('SETTLED');
  expect(journal?.winner).toMatchObject({ bidderId: run.ana.id, amountCents: WINNING_PRICE });

  const status = async (b: Bidder): Promise<HoldRecord['status'] | undefined> =>
    (await rig.stores.holds.get(b.holdId))?.status;
  expect(await status(run.ana)).toBe('CAPTURED');
  expect(await status(run.ben)).toBe('VOIDED');
  expect(await status(run.cy)).toBe('VOIDED');

  const entries = await rig.stores.ledger.read(ledgerKey(run.auctionId), 1);
  const state = evolveAll(entries);
  expect(state.lots[run.auctionId]).toMatchObject({
    status: 'DONE',
    winnerId: run.ana.id,
    capturedCents: WINNING_PRICE,
  });
  const text = exportJsonl(entries);
  expect(verifyJsonl(text)).toMatchObject({ ok: true });
  expect(verifyJsonl(tamperAt(text, 1)).ok).toBe(false);
}

describe('auction flow in one process', () => {
  it('runs create, hold, bid, hammer and settle with one capture and a verifiable ledger', async () => {
    const rig = await newRig();
    const errors: unknown[] = [];
    const service = rig.service({ onError: (_id, e) => errors.push(e) });
    const run = await runToHammer(rig, service);
    await service.idle();
    expect(errors).toEqual([]);

    await expectSettled(rig, run);

    const bids = (await rig.stores.ledger.read(ledgerKey(run.auctionId), 1)).filter(
      (e) => e.type === 'BID_RECORDED',
    );
    expect(bids).toHaveLength(5);
    expect(run.ana.transport.messages('settlement_update').at(-1)).toMatchObject({
      auctionState: 'SETTLED',
      amountCaptured: WINNING_PRICE,
    });
    await service.close();
  });

  it('captures the same single payment after a process death at every boundary', async () => {
    const labels: string[] = [];
    {
      const rig = await newRig();
      const service = rig.service({ boundary: (l) => void labels.push(l) });
      await runToHammer(rig, service);
      await service.idle();
      await service.close();
    }
    expect(labels.length).toBeGreaterThan(20);

    for (let crashAt = 0; crashAt < labels.length; crashAt++) {
      const rig = await newRig();
      let seen = 0;
      const first = rig.service({
        boundary: () => {
          if (seen++ === crashAt) throw new Error('process died');
        },
        onError: () => undefined,
      });
      const run = await runToHammer(rig, first);
      await first.idle();

      // A new process on the same stores finishes the settlement.
      const second = rig.service();
      await second.resume();
      await second.idle();
      try {
        await expectSettled(rig, run);
      } catch (e) {
        throw new Error(`crash at boundary ${crashAt} (${labels[crashAt]}): ${String(e)}`, {
          cause: e,
        });
      }
      await second.close();
    }
  });
});
