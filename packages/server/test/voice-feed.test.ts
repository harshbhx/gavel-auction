import { ManualClock, type AuctionId, type BidderId, type Cents } from '@gavel/shared';
import {
  ReplayStt,
  parseTimeline,
  type AudioBatch,
  type SttEvent,
  type Timeline,
} from '@gavel/voice';
import { describe, expect, it } from 'vitest';
import type { VoiceView } from '../src/room/room';
import { startVoiceBridge, type VoiceFeedMsg, type VoiceRoomPort } from '../src/voice/bridge';

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

const final: SttEvent = {
  type: 'final',
  text: 'paddle seven three fifty',
  words: [],
  startMs: 0,
  endMs: 500,
  confidence: 0.95,
  speechFinal: true,
};

/** A recording whose only event is far in the future, so the stream stays open and mute. */
const MUTE = parseTimeline({
  utterances: [
    {
      startMs: 0,
      endMs: 500,
      expected: { kind: 'accept', bidderId: null, amountCents: null },
      events: [{ atMs: 10_000_000, event: final }],
    },
  ],
});

function rig(timeline: Timeline) {
  const clock = new ManualClock(1_789_000_000_000);
  const timers = new Map<number, () => void>();
  let next = 0;
  const stt = new ReplayStt(timeline, {
    setTimeout: (fn, ms) => {
      next += 1;
      timers.set(next, clock.setTimer(clock.now() + ms, fn));
      return next;
    },
    clearTimeout: (id) => timers.get(id)?.(),
  });
  const room: VoiceRoomPort = {
    voiceView: () => view,
    submitVoiceBid: () => Promise.resolve(),
  };
  const feed: VoiceFeedMsg[] = [];
  const bridge = startVoiceBridge({
    auctionId: AUCTION,
    room,
    stt,
    clock,
    onFeed: (m) => feed.push(m),
  });
  const step = async (ms: number, level: number): Promise<void> => {
    const pcm = new Int16Array(1600).fill(level);
    const batch: AudioBatch = { seq: 0, tsMs: 0, flags: 0, pcm };
    bridge.write(batch);
    clock.advance(ms);
    await new Promise((r) => setImmediate(r));
  };
  return { bridge, feed, step };
}

describe('voice bridge feed (issue 1863)', () => {
  it('forwards a caption for a final transcript', async () => {
    const r = rig(
      parseTimeline({
        utterances: [
          {
            startMs: 0,
            endMs: 500,
            expected: { kind: 'accept', bidderId: null, amountCents: null },
            events: [{ atMs: 600, event: final }],
          },
        ],
      }),
    );
    for (let i = 0; i < 20; i++) await r.step(100, 0);
    await r.bridge.close();
    const captions = r.feed.filter((m) => m.t === 'caption');
    expect(captions.length).toBeGreaterThan(0);
    expect(captions.some((m) => m.t === 'caption' && m.final)).toBe(true);
  });

  it('reports speech degraded then down when loud audio gets no transcript', async () => {
    const r = rig(MUTE);
    for (let i = 0; i < 170; i++) await r.step(100, 8000);
    await r.bridge.close();
    const states = r.feed.flatMap((m) => (m.t === 'status' ? [m.stt] : []));
    expect(states).toContain('degraded');
    expect(states).toContain('down');
  });

  it('stays ok for a quiet room', async () => {
    const r = rig(MUTE);
    for (let i = 0; i < 170; i++) await r.step(100, 0);
    await r.bridge.close();
    expect(r.feed.filter((m) => m.t === 'status' && m.stt !== 'ok')).toEqual([]);
  });

  it('tells the console what became of an utterance, without the amount (UIX-77)', async () => {
    const said = (text: string): Timeline =>
      parseTimeline({
        utterances: [
          {
            startMs: 0,
            endMs: 500,
            expected: { kind: 'accept', bidderId: null, amountCents: null },
            events: [{ atMs: 600, event: { ...final, text } }],
          },
        ],
      });
    const ok = rig(said('paddle seven three fifty'));
    for (let i = 0; i < 20; i++) await ok.step(100, 0);
    await ok.bridge.close();
    const bid = ok.feed.filter((m) => m.t === 'outcome');
    expect(bid).toHaveLength(1);
    expect(bid[0]).toMatchObject({ t: 'outcome', paddle: 7 });
    expect(['bid', 'confirm']).toContain((bid[0] as { kind: string }).kind);
    expect(JSON.stringify(bid[0])).not.toContain('350');

    const none = rig(said('paddle nine three fifty'));
    for (let i = 0; i < 20; i++) await none.step(100, 0);
    await none.bridge.close();
    const dropped = none.feed.filter((m) => m.t === 'outcome');
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toMatchObject({ t: 'outcome', kind: 'drop' });
  });
});
