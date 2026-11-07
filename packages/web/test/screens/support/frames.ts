import { Cents, EpochMs, type AuctionConfig, type RoomSnapshot } from '@gavel/shared';
import type { Scenario } from '../../../src/net/transport';
import { BASE_TIME, auctionId, bidId, bidderId, openSnapshot } from '../../../src/testing/builders';
import {
  Script,
  baseConfig,
  bidders,
  hold,
  settlementView,
} from '../../../src/testing/scenarios/_kit';
import { ambiguous_confirm } from '../../../src/testing/scenarios/ambiguous_confirm';
import { failed_needs_review } from '../../../src/testing/scenarios/failed_needs_review';
import { happy } from '../../../src/testing/scenarios/happy';
import { soft_close } from '../../../src/testing/scenarios/soft_close';

export { happy, soft_close, ambiguous_confirm, failed_needs_review };
export { auctionId, bidderId };

/** Paddles on every scripted room: 12 Priya (the device), 7 Sam, 9 Ana. */
export const ROSTER = bidders([12, 'Priya'], [7, 'Sam'], [9, 'Ana']);

const LOT = { lotTitle: 'Signed first-press vinyl', joinCode: 'K7M2QX' } as const;

function snap(patch: Partial<RoomSnapshot> = {}, config: AuctionConfig = baseConfig): RoomSnapshot {
  return { ...openSnapshot(ROSTER, config), ...LOT, ...patch };
}

/** Moments inside the happy scenario (it runs 0 to 18 s). */
export const HAPPY = {
  idle: 0,
  firstBid: 1_500,
  winning: 3_500,
  outbid: 4_500,
  hammered: 15_500,
  capturing: 17_500,
  settled: 18_500,
} as const;

/** The happy scenario in a room whose auctioneer set a $1,000.00 fundraiser goal. */
export const fundraiser: Scenario = {
  ...happy,
  name: 'fundraiser',
  description: 'Happy path with a fundraiser goal on the snapshot',
  steps: happy.steps.map((step) =>
    step.emit?.t === 'state'
      ? {
          ...step,
          emit: {
            ...step.emit,
            snapshot: { ...step.emit.snapshot, fundraiser: { goalCents: Cents(100_000) } },
          },
        }
      : step,
  ),
};

/** A room that has not opened its lot yet (the auctioneer console is in setup). */
export const scheduled: Scenario = new Script()
  .state(0, snap({ status: 'SCHEDULED' }))
  .build('scheduled', 'Lot not opened yet');

/** An open lot with no bids yet. */
export const noBids: Scenario = new Script().state(0, snap()).build('no_bids', 'Open, no bids');

/** The auctioneer paused the lot clock. */
export const paused: Scenario = new Script()
  .state(0, snap())
  .acceptedBid(1_000, 7, 10_000)
  .state(
    2_000,
    snap({ status: 'PAUSED', paused: true, price: Cents(10_000), minNext: Cents(15_000) }),
  )
  .build('paused', 'Lot paused');

/** The bidder is close to the ceiling of 500 dollars. */
export const nearCeiling: Scenario = new Script()
  .state(0, snap())
  .acceptedBid(1_000, 7, 40_000)
  .acceptedBid(2_000, 12, 45_000)
  .acceptedBid(3_000, 7, 50_000)
  .build('near_ceiling', 'Bidding reaches the bidder ceiling');

function closedSnapshot(winnerPaddle: number | null, cents: number | null): RoomSnapshot {
  return snap({
    status: 'DONE',
    price: cents === null ? null : Cents(cents),
    leaderId: winnerPaddle === null ? null : bidderId(winnerPaddle),
    registrationClosed: true,
  });
}

/** Hammer fell on paddle 12 at 350 dollars, settlement not reported yet. */
export const soldNoSettlement: Scenario = new Script()
  .state(0, snap())
  .acceptedBid(1_000, 7, 30_000)
  .acceptedBid(2_000, 12, 35_000)
  .hammer(3_000, 12, 35_000)
  .state(3_500, closedSnapshot(12, 35_000))
  .build('sold_no_settlement', 'Sold, settlement pending');

/** Nobody bid: the lot passes. */
export const unsold: Scenario = new Script()
  .state(0, snap())
  .hammer(3_000, null, 0)
  .state(3_500, closedSnapshot(null, null))
  .build('unsold', 'Passed with no sale');

/** The auctioneer stopped the room mid-lot. */
export const stopped: Scenario = new Script()
  .state(0, snap())
  .acceptedBid(1_000, 7, 10_000)
  .state(
    2_000,
    snap({ status: 'DONE', stopped: true, price: Cents(10_000), leaderId: bidderId(7) }),
  )
  .build('stopped', 'Room stopped by the operator');

/** Sold to paddle 7 while the device (paddle 12) was outbid. Receipt for a bidder who lost. */
function viewerScript(
  viewer: number,
  winner: number,
  phase: 'CAPTURING' | 'CAPTURED' | 'FAILED_NEEDS_REVIEW',
): Script {
  const price = 35_000;
  const script = new Script()
    .state(0, snap())
    .acceptedBid(1_000, 9, 5_000)
    .acceptedBid(2_000, 7, 30_000)
    .acceptedBid(3_000, winner, price)
    .hammer(4_000, winner, price)
    .state(4_500, closedSnapshot(winner, price));
  const ceilings = new Map<number, number>([
    [12, 50_000],
    [7, 40_000],
    [9, 10_000],
  ]);
  const names = new Map<number, string>([
    [12, 'Priya'],
    [7, 'Sam'],
    [9, 'Ana'],
  ]);
  const holds = [12, 7, 9].map((p) => {
    const ceil = ceilings.get(p) ?? 0;
    const name = names.get(p) ?? '';
    if (p === winner) {
      if (phase === 'CAPTURED') return hold(p, name, ceil, 'CAPTURED', price, ceil - price);
      if (phase === 'FAILED_NEEDS_REVIEW') {
        return hold(p, name, ceil, 'FAILED_NEEDS_REVIEW', 0, 0, { reason: 'capture failed' });
      }
      return hold(p, name, ceil, 'CAPTURING');
    }
    return hold(p, name, ceil, 'SETTLED', 0, ceil);
  });
  return script.settlement(
    5_000,
    settlementView(
      phase,
      winner,
      holds,
      phase !== 'FAILED_NEEDS_REVIEW',
      phase === 'FAILED_NEEDS_REVIEW' ? ['holds not reconciled'] : [],
    ),
    viewer,
  );
}

export const receiptWinner: Scenario = viewerScript(12, 12, 'CAPTURED').build(
  'receipt_winner',
  'Device won and was charged',
);
export const receiptCapturing: Scenario = viewerScript(12, 12, 'CAPTURING').build(
  'receipt_capturing',
  'Device won, capture in progress',
);
export const receiptLoser: Scenario = viewerScript(9, 12, 'CAPTURED').build(
  'receipt_loser',
  'Device lost, hold released',
);
export const receiptFailed: Scenario = viewerScript(12, 12, 'FAILED_NEEDS_REVIEW').build(
  'receipt_failed',
  'Capture failed, needs review',
);
export const receiptNoHold: Scenario = new Script()
  .state(0, snap())
  .acceptedBid(1_000, 7, 30_000)
  .hammer(2_000, 7, 30_000)
  .state(2_500, closedSnapshot(7, 30_000))
  .settlement(
    3_000,
    settlementView('CAPTURED', 7, [hold(7, 'Sam', 40_000, 'CAPTURED', 30_000, 10_000)]),
  )
  .build('receipt_no_hold', 'Device has no hold of its own');

/** The runner-up promoted after the first winner could not be charged: viewer is paddle 7. */
export const receiptFallback: Scenario = new Script()
  .state(0, snap())
  .acceptedBid(1_000, 9, 5_000)
  .acceptedBid(2_000, 7, 30_000)
  .acceptedBid(3_000, 12, 35_000)
  .hammer(4_000, 12, 35_000)
  .state(4_500, closedSnapshot(12, 35_000))
  .settlement(
    5_000,
    settlementView('CAPTURED', 7, [
      hold(12, 'Priya', 50_000, 'FALLBACK_RUNNER_UP', 0, 50_000, { reason: 'hold expired' }),
      hold(7, 'Sam', 40_000, 'CAPTURED', 30_000, 10_000),
      hold(9, 'Ana', 10_000, 'SETTLED', 0, 10_000),
    ]),
    7,
  )
  .build('receipt_fallback', 'Runner-up charged after the winner hold expired');

/** Console with a voice feed, a pending confirmation and a rejected bid in the audit trail. */
export const voiceRoom: Scenario = (() => {
  const script = new Script().state(0, snap()).acceptedBid(1_000, 7, 10_000);
  const row = (
    n: number,
    paddle: number,
    extra: Record<string, unknown>,
    outcome: 'accepted' | 'rejected' | 'superseded' = 'accepted',
  ): void => {
    script.emit(1_000 + n * 200, (e) => ({
      v: 1,
      t: 'audit_event',
      ...e,
      audit: {
        bidId: bidId(40 + n),
        bidderId: bidderId(paddle),
        source: 'voice',
        outcome,
        serverTs: EpochMs(BASE_TIME + 1_000 + n * 200),
        seq: e.seq,
        ...extra,
      } as never,
    }));
  };
  row(1, 7, {
    transcript: 'one hundred paddle seven',
    parsedAmount: Cents(10_000),
    confidence: 0.96,
    audioTsMs: 900,
    audioEndMs: 2_300,
  });
  row(2, 12, {
    transcript: 'one fifty twelve',
    parsedAmount: Cents(15_000),
    confidence: 0.91,
    audioTsMs: 3_100,
    audioEndMs: 4_200,
  });
  row(
    3,
    9,
    {
      transcript: 'two hundred nine',
      parsedAmount: Cents(20_000),
      confidence: 0.58,
      confirmed: false,
      audioTsMs: 5_300,
      audioEndMs: 6_400,
    },
    'rejected',
  );
  row(
    4,
    7,
    { transcript: 'what is the lot again', confidence: 0.4, audioTsMs: 7_200, audioEndMs: 8_300 },
    'rejected',
  );
  script.emit(4_000, (e) => ({
    v: 1,
    t: 'confirm_request',
    ...e,
    confirmId: 'confirm-1',
    amount: Cents(20_000),
    transcript: 'two hundred nine',
    expiresAt: EpochMs(BASE_TIME + 4_000 + 20_000),
  }));
  return script.build('voice_room', 'Voice transcripts, parse chips and a confirmation');
})();

/** Audit trail with every outcome and source. */
export const auditRoom: Scenario = (() => {
  const script = new Script().state(0, snap());
  const add = (
    n: number,
    paddle: number,
    source: 'voice' | 'qr' | 'manual',
    outcome: 'accepted' | 'rejected' | 'expired' | 'superseded',
    extra: Record<string, unknown>,
  ): void => {
    script.emit(1_000 * n, (e) => ({
      v: 1,
      t: 'audit_event',
      ...e,
      audit: {
        bidId: bidId(60 + n),
        bidderId: bidderId(paddle),
        source,
        outcome,
        serverTs: EpochMs(BASE_TIME + 1_000 * n),
        seq: e.seq,
        ...extra,
      } as never,
    }));
  };
  add(1, 9, 'qr', 'accepted', { parsedAmount: Cents(5_000) });
  add(2, 7, 'voice', 'accepted', {
    transcript: 'one fifty paddle seven',
    parsedAmount: Cents(15_000),
    confidence: 0.94,
    audioTsMs: 1_800,
    audioEndMs: 3_000,
    confirmed: true,
  });
  add(3, 12, 'qr', 'rejected', { parsedAmount: Cents(90_000), reason: 'over_ceiling' });
  add(4, 12, 'voice', 'superseded', {
    transcript: 'two fifty twelve',
    parsedAmount: Cents(25_000),
    confidence: 0.88,
    audioTsMs: 3_900,
    audioEndMs: 5_000,
  });
  add(5, 9, 'manual', 'accepted', { parsedAmount: Cents(30_000) });
  add(6, 7, 'voice', 'rejected', {
    transcript: 'three fifty',
    parsedAmount: Cents(35_000),
    confidence: 0.52,
    confirmed: false,
    reason: 'unconfirmed',
    audioTsMs: 5_600,
    audioEndMs: 6_400,
  });
  add(7, 12, 'qr', 'expired', { parsedAmount: Cents(40_000), reason: 'expired' });
  add(8, 12, 'qr', 'accepted', { parsedAmount: Cents(35_000) });
  return script.build('audit_room', 'Audit rows of every outcome and source');
})();

/** Full per-hold settlement detail for the ladder view on the console. */
export const ladderRoom: Scenario = (() => {
  const script = new Script()
    .state(0, snap())
    .acceptedBid(1_000, 7, 30_000)
    .acceptedBid(2_000, 12, 35_000)
    .hammer(3_000, 12, 35_000)
    .state(3_500, closedSnapshot(12, 35_000));
  const holds = [
    {
      paddle: 12,
      state: 'CAPTURED',
      capturedCents: 35_000,
      releasedCents: 15_000,
      idSuffix: 'AB0012',
      verifiedBy: [
        {
          eventId: 'evt-capture-1',
          kind: 'webhook',
          eventType: 'PAYMENT.CAPTURE.COMPLETED',
          at: BASE_TIME + 4_000,
        },
      ],
    },
    {
      paddle: 7,
      state: 'SETTLED',
      capturedCents: 0,
      releasedCents: 40_000,
      idSuffix: 'AB0007',
      verifiedBy: [],
    },
    {
      paddle: 9,
      state: 'SETTLED',
      capturedCents: 0,
      releasedCents: 10_000,
      idSuffix: 'AB0009',
      verifiedBy: [],
    },
  ];
  script.emit(
    4_000,
    (e) =>
      ({
        v: 1,
        t: 'settlement_update',
        ...e,
        rev: 1,
        auctionState: 'CAPTURED',
        amountCaptured: Cents(35_000),
        winnerPaddle: 12,
        holds,
        invariants: { ok: true, violations: [] },
        ladder: { counts: { CAPTURED: 1, SETTLED: 2 } },
      }) as never,
  );
  return script.build('ladder_room', 'Settlement with full per-hold detail');
})();

/** Settlement stopped for review, with per-hold detail. */
export const ladderFailed: Scenario = (() => {
  const script = new Script()
    .state(0, snap())
    .acceptedBid(1_000, 12, 35_000)
    .hammer(3_000, 12, 35_000)
    .state(3_500, closedSnapshot(12, 35_000));
  script.emit(
    4_000,
    (e) =>
      ({
        v: 1,
        t: 'settlement_update',
        ...e,
        rev: 1,
        auctionState: 'FAILED_NEEDS_REVIEW',
        winnerPaddle: 12,
        holds: [
          {
            paddle: 12,
            state: 'FAILED_NEEDS_REVIEW',
            capturedCents: 0,
            releasedCents: 0,
            idSuffix: 'AB0012',
            verifiedBy: [],
          },
          {
            paddle: 7,
            state: 'SETTLED',
            capturedCents: 0,
            releasedCents: 40_000,
            idSuffix: 'AB0007',
            verifiedBy: [],
          },
        ],
        invariants: { ok: false, violations: ['holds not reconciled: 50000 unaccounted'] },
        ladder: { counts: { FAILED_NEEDS_REVIEW: 1, SETTLED: 1 } },
      }) as never,
  );
  return script.build('ladder_failed', 'Settlement stopped for review');
})();

/** A state snapshot that registration reads: registration still open, or closed. */
export function registrationRoom(closed: boolean): Scenario {
  return new Script()
    .state(0, snap(closed ? { status: 'DONE', registrationClosed: true } : {}))
    .build(closed ? 'registration_closed' : 'registration_open', 'Registration room');
}

export const REGISTER_ROOM_ID = auctionId();
