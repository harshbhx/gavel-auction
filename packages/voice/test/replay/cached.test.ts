import { describe, expect, it } from 'vitest';
import { decide } from '../../src/decide/decide.js';
import { diffExpectations, exitCodeFor, formatDiff, outcomeOf } from '../../src/replay/diff.js';
import { VirtualClock } from '../../src/stt/fake.js';
import { ReplayStt, parseTimeline, type ExpectedOutcome } from '../../src/stt/replay.js';
import type { SttEvent } from '../../src/stt/provider.js';
import type { BidContext, ParseResult } from '../../src/types.js';

const expectedAccept: ExpectedOutcome = { kind: 'accept', bidderId: 'b12', amountCents: 15_000 };

function timelineInput(expected: ExpectedOutcome): unknown {
  return {
    utterances: [
      {
        startMs: 100,
        endMs: 900,
        expected,
        events: [
          { atMs: 400, event: { type: 'interim', text: 'paddle', startMs: 100 } },
          {
            atMs: 700,
            event: {
              type: 'final',
              text: 'paddle twelve one fifty',
              words: [],
              startMs: 100,
              endMs: 900,
              confidence: 0.95,
              speechFinal: true,
            },
          },
          { atMs: 800, event: { type: 'utterance_end', atMs: 900 } },
        ],
      },
    ],
  };
}

const ctx: BidContext = {
  nowMs: 10_000,
  lotState: 'OPEN',
  currentPriceCents: 10_000,
  minIncrementCents: 500,
  highBidderId: null,
  roster: new Map([['12', { bidderId: 'b12', ceilingCents: 1_000_000, holdActive: true }]]),
  recent: [],
};

const parse: ParseResult = {
  status: 'bid',
  bidder: { kind: 'paddle', value: '12' },
  amountCents: 15_000,
  reason: 'ok',
  candidates: [],
  flags: [],
  confidence: 0.95,
  source: 'rules',
};

async function run(expected: ExpectedOutcome): Promise<{
  timed: Array<{ at: number; event: SttEvent }>;
  actual: ExpectedOutcome[];
}> {
  const clock = new VirtualClock();
  const stt = new ReplayStt(parseTimeline(timelineInput(expected)), clock);
  const timed: Array<{ at: number; event: SttEvent }> = [];
  const actual: ExpectedOutcome[] = [];
  const done = (async () => {
    for await (const event of stt.events()) {
      timed.push({ at: clock.now(), event });
      if (event.type === 'final') {
        const d = decide(
          {
            segmentId: 's1',
            idempotencyKey: 'room:lot:100:abc',
            transcript: event.text,
            audioStartMs: event.startMs,
            audioEndMs: event.endMs,
            sttProvider: stt.name,
            sttConfidence: event.confidence,
            replay: true,
          },
          parse,
          parse,
          ctx,
        );
        actual.push(outcomeOf(d));
      }
    }
  })();
  await stt.start();
  for (let t = 0; t < 1000; t++) {
    clock.advance(1);
    for (let i = 0; i < 5; i++) await Promise.resolve();
  }
  await done;
  return { timed, actual };
}

describe('cached replay', () => {
  it('T-VOX-090: delivers recorded events at recorded offsets and ends by itself', async () => {
    const { timed, actual } = await run(expectedAccept);
    const at = (type: SttEvent['type']): number | undefined =>
      timed.find((x) => x.event.type === type)?.at;
    expect(at('interim')).toBe(400);
    expect(at('final')).toBe(700);
    expect(at('utterance_end')).toBe(800);
    const last = timed[timed.length - 1];
    expect(last?.event).toEqual({ type: 'state', state: 'closed' });
    expect(diffExpectations([expectedAccept], actual)).toEqual([]);
  });

  it('T-VOX-090: a changed expectation gives a non-empty diff and exit code 1', async () => {
    const changed: ExpectedOutcome = { kind: 'accept', bidderId: 'b12', amountCents: 16_000 };
    const { actual } = await run(changed);
    const diff = diffExpectations([changed], actual);
    expect(diff).toHaveLength(1);
    expect(exitCodeFor(diff)).toBe(1);
    expect(formatDiff(diff)).toContain('expected accept bidder=b12 amount=16000');
    expect(exitCodeFor([])).toBe(0);
  });

  it('rejects malformed timelines', () => {
    expect(() => parseTimeline({ utterances: [{ startMs: 5, endMs: 1 }] })).toThrow();
    const bad = {
      utterances: [
        { startMs: 500, endMs: 600, expected: expectedAccept, events: [] },
        { startMs: 100, endMs: 200, expected: expectedAccept, events: [] },
      ],
    };
    expect(() => parseTimeline(bad)).toThrow();
  });
});
