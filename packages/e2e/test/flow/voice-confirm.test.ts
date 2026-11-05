import type { AuctionId } from '@gavel/shared';
import type { AuctionService } from '@gavel/server';
import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG, bidMessage, enroll, ledgerKey, makeRig, type Bidder, type Rig } from './rig';

/**
 * The voice confirm gate through the real room (R-RT-045, R-RT-046): a low-confidence or
 * ambiguous voice bid is held, the engine sees nothing until the bidder accepts, and the audit
 * block on the ledger entry carries the transcript, confidence and confirmation.
 */

const open: Array<{ stop(): Promise<void> }> = [];

afterEach(async () => {
  for (const p of open.splice(0)) await p.stop();
});

const TRANSCRIPT = 'one fifty for paddle nine';

interface Setup {
  rig: Rig;
  service: AuctionService;
  auctionId: AuctionId;
  ana: Bidder;
  room: Awaited<ReturnType<AuctionService['createAuction']>>;
}

async function setup(): Promise<Setup> {
  const rig = await makeRig();
  open.push(rig.paypal);
  const service = rig.service();
  const auctionId = rig.ids.mint<'AuctionId'>();
  const room = await service.createAuction(auctionId, CONFIG, 'auctioneer-sub');
  const ana = await enroll(rig, service, room, auctionId, 'Ana', 50000);
  return { rig, service, auctionId, ana, room };
}

async function recordedBids(s: Setup) {
  const entries = await s.rig.stores.ledger.read(ledgerKey(s.auctionId), 1);
  return entries.filter((e) => e.type === 'BID_RECORDED');
}

async function roomEvents(s: Setup, type: string) {
  const events = await s.rig.stores.store.readEvents(s.auctionId, 1, 1000);
  return events.filter((e) => e.type === type);
}

function confirmId(s: Setup): string {
  const requests = s.ana.transport.messages('confirm_request');
  expect(requests).toHaveLength(1);
  const id = requests[0]?.['confirmId'];
  if (typeof id !== 'string') throw new Error('confirm_request carries no confirmId');
  return id;
}

describe('voice confirm gate in one process', () => {
  it('holds a bid at confidence 0.5 until the bidder accepts, then records the audit block', async () => {
    const s = await setup();
    await s.room.submitBid(
      s.ana.conn,
      bidMessage(s.rig, 15000, 'voice', { confidence: 0.5, transcript: TRANSCRIPT }),
    );
    await s.service.idle();

    expect(await recordedBids(s)).toHaveLength(0);
    expect(await roomEvents(s, 'bid_accepted')).toHaveLength(0);
    expect(s.ana.transport.messages('confirm_request')[0]).toMatchObject({
      amount: 15000,
      transcript: TRANSCRIPT,
    });

    await s.room.respondConfirm(s.ana.conn, {
      v: 1,
      t: 'confirm_response',
      confirmId: confirmId(s),
      accept: true,
    });
    await s.service.idle();

    const bids = await recordedBids(s);
    expect(bids).toHaveLength(1);
    expect(bids[0]).toMatchObject({
      payload: {
        amountCents: 15000,
        source: 'voice',
        audit: { transcript: TRANSCRIPT, confidenceBps: 5000, confirmed: true },
      },
    });
    const accepted = await roomEvents(s, 'bid_accepted');
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({
      audit: { transcript: TRANSCRIPT, confidence: 0.5, confirmed: true, outcome: 'accepted' },
    });
    await s.service.close();
  });

  it('places no bid when the bidder declines', async () => {
    const s = await setup();
    await s.room.submitBid(
      s.ana.conn,
      bidMessage(s.rig, 15000, 'voice', { confidence: 0.5, transcript: TRANSCRIPT }),
    );
    await s.room.respondConfirm(s.ana.conn, {
      v: 1,
      t: 'confirm_response',
      confirmId: confirmId(s),
      accept: false,
    });
    await s.service.idle();

    expect(await recordedBids(s)).toHaveLength(0);
    expect(await roomEvents(s, 'bid_accepted')).toHaveLength(0);
    expect(await roomEvents(s, 'confirm_resolved')).toMatchObject([
      { outcome: 'rejected', audit: { outcome: 'rejected' } },
    ]);
    await s.service.close();
  });

  it('places no bid when the confirmation times out', async () => {
    const s = await setup();
    await s.room.submitBid(
      s.ana.conn,
      bidMessage(s.rig, 15000, 'voice', { confidence: 0.5, transcript: TRANSCRIPT }),
    );
    const id = confirmId(s);
    s.rig.clock.advance(15_001);
    await s.service.idle();

    expect(await roomEvents(s, 'confirm_resolved')).toMatchObject([{ outcome: 'expired' }]);
    await s.room.respondConfirm(s.ana.conn, { v: 1, t: 'confirm_response', confirmId: id, accept: true });
    await s.service.idle();

    expect(await recordedBids(s)).toHaveLength(0);
    expect(await roomEvents(s, 'bid_accepted')).toHaveLength(0);
    expect(s.ana.transport.messages('error').some((m) => m['code'] === 'not_found')).toBe(true);
    await s.service.close();
  });

  it('holds an ambiguous bid even at high confidence', async () => {
    const s = await setup();
    await s.room.submitBid(
      s.ana.conn,
      bidMessage(s.rig, 15000, 'voice', {
        confidence: 0.99,
        transcript: TRANSCRIPT,
        ambiguous: true,
      }),
    );
    await s.service.idle();

    expect(s.ana.transport.messages('confirm_request')).toHaveLength(1);
    expect(await recordedBids(s)).toHaveLength(0);
    expect(await roomEvents(s, 'bid_accepted')).toHaveLength(0);
    await s.service.close();
  });

  it('lets a confident, unambiguous voice bid through without a confirmation', async () => {
    const s = await setup();
    await s.room.submitBid(
      s.ana.conn,
      bidMessage(s.rig, 15000, 'voice', { confidence: 0.95, transcript: TRANSCRIPT }),
    );
    await s.service.idle();

    expect(s.ana.transport.messages('confirm_request')).toHaveLength(0);
    const bids = await recordedBids(s);
    expect(bids).toHaveLength(1);
    expect(bids[0]).toMatchObject({
      payload: { audit: { transcript: TRANSCRIPT, confidenceBps: 9500 } },
    });
    await s.service.close();
  });
});
