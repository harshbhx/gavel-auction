import {
  ManualClock,
  isUlid,
  type AuctionId,
  type BidMsg,
  type BidderId,
  type Cents,
} from '@gavel/shared';
import { ReplayStt, parseTimeline, type SttEvent } from '@gavel/voice';
import { describe, expect, it } from 'vitest';
import type { VoiceView } from '../src/room/room';
import { startVoiceBridge, type VoiceRoomPort } from '../src/voice/bridge';

const AUCTION = '01J9ZQ5A0B2C4D6F8H0J2K4M6N' as AuctionId;
const B7 = '01J9ZQ3A0B2C4D6F8H0J2K4M6N' as BidderId;

const view: VoiceView = {
  open: true,
  price: 30000 as Cents,
  minNext: 31000 as Cents,
  minIncrement: 1000 as Cents,
  leader: null,
  confirmThreshold: 0.85,
  roster: [{ bidderId: B7, paddle: '7' }],
};

const final = (text: string, confidence: number): SttEvent => ({
  type: 'final',
  text,
  words: [],
  startMs: 0,
  endMs: 500,
  confidence,
  speechFinal: true,
});

/** Cached provider on the manual clock: events play at their recorded offsets. */
async function run(events: Array<{ atMs: number; event: SttEvent }>, current: VoiceView = view) {
  const clock = new ManualClock(1_789_000_000_000);
  const bids: Array<{ bidderId: BidderId; msg: BidMsg }> = [];
  const room: VoiceRoomPort = {
    voiceView: () => current,
    submitVoiceBid: (bidderId, msg) => {
      bids.push({ bidderId, msg });
      return Promise.resolve();
    },
  };
  const timers = new Map<number, ReturnType<typeof clock.setTimer>>();
  let next = 0;
  const stt = new ReplayStt(
    parseTimeline({
      utterances: [
        {
          startMs: 0,
          endMs: 500,
          expected: { kind: 'accept', bidderId: null, amountCents: null },
          events,
        },
      ],
    }),
    {
      setTimeout: (fn, ms) => {
        next += 1;
        timers.set(next, clock.setTimer(clock.now() + ms, fn));
        return next;
      },
      clearTimeout: (id) => timers.get(id)?.(),
    },
  );
  const bridge = startVoiceBridge({ auctionId: AUCTION, room, stt, clock });
  for (let i = 0; i < 40; i++) {
    clock.advance(100);
    await new Promise((r) => setImmediate(r));
  }
  await bridge.done;
  return bids;
}

describe('voice bridge (HRD-67)', () => {
  it('hands a confident accepted bid to the room as a voice bid with its confidence', async () => {
    const bids = await run([{ atMs: 600, event: final('paddle seven three fifty', 0.95) }]);
    expect(bids).toHaveLength(1);
    expect(bids[0]?.bidderId).toBe(B7);
    expect(bids[0]?.msg).toMatchObject({
      source: 'voice',
      amount: 35000,
      transcript: 'paddle seven three fifty',
    });
    expect(bids[0]?.msg.confidence).toBeGreaterThanOrEqual(0.85);
    expect(isUlid(bids[0]?.msg.mid ?? '')).toBe(true);
  });

  it('sends a low confidence parse flagged ambiguous so the room asks the bidder', async () => {
    const bids = await run([{ atMs: 600, event: final('paddle seven three fifty', 0.6) }]);
    expect(bids).toHaveLength(1);
    expect(bids[0]?.msg).toMatchObject({ source: 'voice', ambiguous: true, amount: 35000 });
    expect(bids[0]?.bidderId).toBe(B7);
  });

  it('sends nothing for speech that is not a bid or names nobody on the roster', async () => {
    expect(await run([{ atMs: 600, event: final('good evening everyone', 0.95) }])).toHaveLength(0);
    expect(await run([{ atMs: 600, event: final('paddle nine three fifty', 0.95) }])).toHaveLength(
      0,
    );
  });

  it('sends nothing while the lot is not open', async () => {
    const closed: VoiceView = { ...view, open: false };
    expect(
      await run([{ atMs: 600, event: final('paddle seven three fifty', 0.95) }], closed),
    ).toHaveLength(0);
  });
});
