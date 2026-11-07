import { ManualClock, type AuctionId, type BidMsg, type BidderId, type Cents } from '@gavel/shared';
import {
  parseTimeline,
  type AudioBatch,
  type FailoverClock,
  type SttEvent,
  type SttProvider,
  type Timeline,
} from '@gavel/voice';
import { describe, expect, it } from 'vitest';
import type { VoiceView } from '../src/room/room';
import { startVoiceBridge, type VoiceFeedMsg, type VoiceRoomPort } from '../src/voice/bridge';
import { chooseStt, type SttChoice } from '../src/voice/stt';

const AUCTION = '01J9ZQ5A0B2C4D6F8H0J2K4M6N' as AuctionId;
const B7 = '01J9ZQ3A0B2C4D6F8H0J2K4M6N' as BidderId;
const START = 1_789_000_000_000;

const view: VoiceView = {
  open: true,
  price: 30000 as Cents,
  minNext: 31000 as Cents,
  minIncrement: 1000 as Cents,
  leader: null,
  confirmThreshold: 0.85,
  roster: [{ bidderId: B7, paddle: '7' }],
};

const final = (text: string, startMs: number, endMs: number, confidence: number): SttEvent => ({
  type: 'final',
  text,
  words: [],
  startMs,
  endMs,
  confidence,
  speechFinal: true,
});

/** A provider the test drives by hand; it never touches the network. */
class TestStt implements SttProvider {
  readonly written: AudioBatch[] = [];
  started = false;
  stopped = false;
  /** Events emitted as soon as the first audio batch arrives (a provider hearing replayed audio). */
  onFirstWrite: SttEvent[] = [];
  private queue: SttEvent[] = [];
  private waiter: ((r: IteratorResult<SttEvent>) => void) | null = null;
  private done = false;

  constructor(readonly name: 'deepgram' | 'groq') {}

  start(): Promise<void> {
    this.started = true;
    return Promise.resolve();
  }

  write(batch: AudioBatch): void {
    const first = this.written.length === 0;
    this.written.push(batch);
    if (first) for (const e of this.onFirstWrite) this.emit(e);
  }

  emit(e: SttEvent): void {
    if (this.done) return;
    const w = this.waiter;
    if (w) {
      this.waiter = null;
      w({ value: e, done: false });
    } else this.queue.push(e);
  }

  /** The vendor connection ended on its own. */
  drop(): void {
    this.emit({ type: 'error', code: 'closed', retryable: false });
    this.emit({ type: 'state', state: 'closed' });
  }

  events(): AsyncIterable<SttEvent> {
    return {
      [Symbol.asyncIterator]: () => ({
        next: (): Promise<IteratorResult<SttEvent>> => {
          const e = this.queue.shift();
          if (e) return Promise.resolve({ value: e, done: false });
          if (this.done) return Promise.resolve({ value: undefined, done: true });
          return new Promise((resolve) => {
            this.waiter = resolve;
          });
        },
      }),
    };
  }

  stop(): Promise<void> {
    this.stopped = true;
    this.done = true;
    this.waiter?.({ value: undefined, done: true });
    this.waiter = null;
    return Promise.resolve();
  }
}

function loud(seq: number): AudioBatch {
  const pcm = new Int16Array(1600);
  pcm.fill(8000);
  return { seq, tsMs: seq * 100, flags: 0, pcm };
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};

/** A recorded utterance, so the cached provider has something to play. */
const RECORDING: Timeline = parseTimeline({
  utterances: [
    {
      startMs: 0,
      endMs: 500,
      expected: { kind: 'accept', bidderId: null, amountCents: null },
      events: [{ atMs: 10_000_000, event: final('paddle seven three fifty', 0, 500, 0.95) }],
    },
  ],
});

const KEYS = { DEEPGRAM_API_KEY: 'dg-test', GROQ_API_KEY: 'gq-test' };

function rig(env: Record<string, string>, timeline: Timeline | undefined = RECORDING) {
  const clock = new ManualClock(START);
  const timers = new Map<number, () => void>();
  let next = 0;
  const failoverClock: FailoverClock = {
    now: () => clock.now(),
    setTimeout: (fn, ms) => {
      next += 1;
      timers.set(next, clock.setTimer(clock.now() + ms, fn));
      return next;
    },
    clearTimeout: (id) => timers.get(id)?.(),
  };
  const deepgrams: TestStt[] = [];
  const groqs: TestStt[] = [];
  const logs: string[] = [];
  const choice: SttChoice = chooseStt(
    { VOICE_STT: 'deepgram', ...env },
    {
      ...(timeline === undefined ? {} : { timeline }),
      scheduler: { setTimeout: () => 0, clearTimeout: () => undefined },
      failoverClock,
      socket: () => {
        throw new Error('no network in tests');
      },
      factories: {
        deepgram: () => {
          const p = new TestStt('deepgram');
          deepgrams.push(p);
          return p;
        },
        groq: () => {
          const p = new TestStt('groq');
          groqs.push(p);
          return p;
        },
      },
      log: (m) => logs.push(m),
    },
  );
  // chooseStt builds one throwaway provider to learn the name; only make() streams count.
  deepgrams.length = 0;
  groqs.length = 0;
  return { clock, choice, deepgrams, groqs, logs };
}

describe('live speech backup (Deepgram, then Groq, then cached)', () => {
  it('moves to Groq when the Deepgram stream drops, and hands it the recent audio', async () => {
    const r = rig(KEYS);
    expect(r.choice.name).toBe('deepgram');
    const stt = r.choice.make();
    const seen: SttEvent[] = [];
    void (async () => {
      for await (const e of stt.events()) seen.push(e);
    })();
    await stt.start({ keyterms: [], language: 'en' });
    expect(stt.name).toBe('deepgram');
    stt.write(loud(0));
    stt.write(loud(1));
    r.deepgrams[0]?.drop();
    await settle();
    expect(stt.name).toBe('groq');
    expect(r.groqs).toHaveLength(1);
    expect(r.groqs[0]?.written.length).toBe(2);
    expect(r.deepgrams[0]?.stopped).toBe(true);
    stt.write(loud(2));
    r.groqs[0]?.emit(final('paddle seven three fifty', 0, 500, 0.9));
    await settle();
    expect(seen.some((e) => e.type === 'final')).toBe(true);
    await stt.stop();
  });

  it('moves to Groq when Deepgram fails to connect', async () => {
    const r = rig(KEYS);
    const stt = r.choice.make();
    void (async () => {
      for await (const e of stt.events()) void e;
    })();
    await stt.start({ keyterms: [], language: 'en' });
    r.deepgrams[0]?.emit({ type: 'error', code: 'timeout', retryable: true });
    r.deepgrams[0]?.emit({ type: 'state', state: 'closed' });
    await settle();
    expect(stt.name).toBe('groq');
    await stt.stop();
  });

  it('plays the cached recording when both live providers are down', async () => {
    const r = rig(KEYS);
    const stt = r.choice.make();
    void (async () => {
      for await (const e of stt.events()) void e;
    })();
    await stt.start({ keyterms: [], language: 'en' });
    stt.write(loud(0));
    r.deepgrams[0]?.drop();
    await settle();
    expect(stt.name).toBe('groq');
    r.groqs[0]?.drop();
    await settle();
    expect(stt.name).toBe('replay');
    await stt.stop();
  });

  it('returns to Deepgram after the circuit window once it answers again', async () => {
    const r = rig(KEYS);
    const stt = r.choice.make();
    void (async () => {
      for await (const e of stt.events()) void e;
    })();
    await stt.start({ keyterms: [], language: 'en' });
    stt.write(loud(0));
    r.deepgrams[0]?.drop();
    await settle();
    expect(stt.name).toBe('groq');
    r.clock.advance(31_000);
    stt.write(loud(1));
    await settle();
    expect(r.deepgrams).toHaveLength(2);
    r.deepgrams[1]?.emit({ type: 'interim', text: 'paddle', startMs: 0 });
    await settle();
    r.clock.advance(3_100);
    await settle();
    expect(stt.name).toBe('deepgram');
    await stt.stop();
  });

  it('uses Groq alone when only the Deepgram key is missing', () => {
    const r = rig({ GROQ_API_KEY: 'gq-test' });
    expect(r.choice.name).toBe('groq');
    expect(r.choice.make().name).toBe('groq');
    expect(r.logs).toContain('deepgram not usable, using groq');
  });

  it('keeps Deepgram with the cached fallback when only the Groq key is missing', async () => {
    const r = rig({ DEEPGRAM_API_KEY: 'dg-test' });
    expect(r.choice.name).toBe('deepgram');
    const stt = r.choice.make();
    void (async () => {
      for await (const e of stt.events()) void e;
    })();
    await stt.start({ keyterms: [], language: 'en' });
    stt.write(loud(0));
    r.deepgrams[0]?.drop();
    await settle();
    expect(stt.name).toBe('replay');
    expect(r.groqs).toHaveLength(0);
    await stt.stop();
  });

  it('uses the cached provider when neither key is set', () => {
    const r = rig({});
    expect(r.choice.name).toBe('replay');
    expect(r.logs).toContain('stt provider not usable, using cached provider');
  });
});

describe('voice bridge across a provider switch', () => {
  async function runBridge(opts: { groqHears: boolean; seconds: number }) {
    const r = rig(KEYS);
    const bids: Array<{ bidderId: BidderId; msg: BidMsg }> = [];
    const feeds: VoiceFeedMsg[] = [];
    const room: VoiceRoomPort = {
      voiceView: () => view,
      submitVoiceBid: (bidderId, msg) => {
        bids.push({ bidderId, msg });
        return Promise.resolve();
      },
    };
    const stt = r.choice.make();
    const bridge = startVoiceBridge({
      auctionId: AUCTION,
      room,
      stt,
      clock: r.clock,
      onFeed: (m) => feeds.push(m),
    });
    const step = async (): Promise<void> => {
      r.clock.advance(100);
      await settle();
    };
    let seq = 0;
    for (let i = 0; i < 3; i++) {
      bridge.write(loud(seq++));
      await step();
    }
    // Deepgram hears the bid, then drops.
    r.deepgrams[0]?.emit(final('paddle seven three fifty', 0, 500, 0.95));
    await step();
    await step();
    // Groq receives the replayed audio and hears the very same utterance.
    if (opts.groqHears) {
      const groqCopy = final('paddle seven three fifty', 20, 520, 0.9);
      const dg = r.deepgrams[0];
      dg?.drop();
      await settle();
      r.groqs[0]?.emit(groqCopy);
    } else {
      r.deepgrams[0]?.drop();
      await settle();
      r.groqs[0]?.drop();
    }
    for (let i = 0; i < opts.seconds * 10; i++) {
      // A live Groq keeps answering the room's talk; only the second case has no provider left.
      if (opts.groqHears && i % 10 === 0) {
        const at = 1000 + i * 100;
        r.groqs[0]?.emit(final('hello everyone', at, at + 400, 0.9));
      }
      bridge.write(loud(seq++));
      await step();
    }
    await bridge.close();
    return { bids, feeds, stt, r };
  }

  it('books the same spoken bid once when both providers heard it', async () => {
    const { bids } = await runBridge({ groqHears: true, seconds: 2 });
    expect(bids.length).toBeGreaterThanOrEqual(1);
    expect(new Set(bids.map((b) => b.msg.mid)).size).toBe(1);
    for (const b of bids) expect(b.msg.source).toBe('voice');
  });

  it('shows no outage while Groq is live', async () => {
    const { feeds } = await runBridge({ groqHears: true, seconds: 20 });
    const statuses = feeds.filter((f) => f.t === 'status');
    expect(statuses.some((f) => f.stt !== 'ok')).toBe(false);
  });

  it('raises the outage status only once no live provider is left', async () => {
    const { feeds } = await runBridge({ groqHears: false, seconds: 20 });
    const statuses = feeds.flatMap((f) => (f.t === 'status' ? [f.stt] : []));
    expect(statuses).toContain('down');
  });
});
